import asyncio
import json

from pydantic import BaseModel, ConfigDict, Field, model_validator

from worker.handlers.config import DynamicConfig
from worker.models import JsonObject, StorageReference
from worker.progress import ProgressReporter
from worker.services.registry import get_storage
from worker.services.util import build_object_key
from worker.services.vad import (
    ChunkingConfig,
    SpeechSegment,
    build_chunks,
    get_wav_segments,
)
from worker.storage import temporary_directory


class AudioChunkingInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    audio_source: StorageReference = Field(alias="audioSource")
    record_id: str = Field(alias="recordId", min_length=1)


class AudioManifestChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: float = Field(ge=0)
    end: float = Field(gt=0)
    silence_after: float = Field(ge=0)

    @model_validator(mode="after")
    def end_must_be_after_start(self) -> "AudioManifestChunk":
        if self.end <= self.start:
            raise ValueError("Chunk end must be greater than start")
        return self


class AudioManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_offset: float = Field(ge=0)
    end_offset: float = Field(ge=0)
    vad_object_key: str = Field(min_length=1)
    chunks: list[AudioManifestChunk]


async def handle_audio_chunking(
    input: JsonObject,
    config: JsonObject,
    progress: ProgressReporter,
) -> JsonObject:
    storage = get_storage()
    data = AudioChunkingInput.model_validate(input)
    cfg = DynamicConfig.model_validate(config)
    vad_config = ChunkingConfig(**cfg.chunking.model_dump())

    await progress.set_total_steps(5)
    async with temporary_directory() as directory:
        audio_source = directory / "source.wav"
        manifest_path = directory / "manifest.json"
        vad_path = directory / "vad.json"

        manifest_object_key = build_object_key(data.record_id, "audio/manifest.json")
        vad_object_key = build_object_key(data.record_id, "audio/vad.json")

        async with progress.step("audio_chunking.download", False):
            await storage.download(data.audio_source, audio_source)

        async with progress.step("audio_chunking.vad") as step:
            wav, segments = await get_wav_segments(str(audio_source), 16000, step)
        duration = len(wav) / 16000

        async with progress.step("audio_chunking.chunks", False):
            chunks = build_chunks(segments, duration, vad_config)

        async with progress.step("audio_chunking.save", False):
            manifest = build_manifest(chunks, duration, vad_object_key)
            await asyncio.to_thread(
                manifest_path.write_text,
                manifest.model_dump_json(),
                encoding="utf-8",
            )
            await asyncio.to_thread(
                vad_path.write_text, json.dumps(segments), encoding="utf-8"
            )

        async with progress.step("audio_chunking.upload", False):
            await storage.upload(vad_path, vad_object_key)
            await storage.upload(manifest_path, manifest_object_key)

    return {"bucket": data.audio_source.bucket, "manifestKey": manifest_object_key}


def build_manifest(
    chunks: list[SpeechSegment],
    duration: float,
    vad_obj_key: str,
) -> AudioManifest:
    leading_removed = chunks[0]["start"] if chunks else duration
    trailing_removed = duration - chunks[-1]["end"] if chunks else 0
    return AudioManifest(
        start_offset=leading_removed,
        end_offset=trailing_removed,
        vad_object_key=vad_obj_key,
        chunks=[
            AudioManifestChunk(
                start=round(chunk["start"], 3),
                end=round(chunk["end"], 3),
                silence_after=round(chunk["removed_silence_after"], 3),
            )
            for chunk in chunks
        ],
    )
