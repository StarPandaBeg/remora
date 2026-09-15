import asyncio
import json
from pathlib import Path

import torchaudio
from pydantic import BaseModel, ConfigDict, Field
from torch import Tensor

from worker.handlers.config import DynamicConfig
from worker.models import JsonObject, StorageReference
from worker.progress import ProgressReporter
from worker.services.util import build_object_key
from worker.services.vad import (
    ChunkingConfig,
    SpeechSegment,
    build_chunks,
    get_wav_segments,
)
from worker.storage import MinioStorage, temporary_directory


class AudioChunkingInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    audio_source: StorageReference = Field(alias="audioSource")
    record_id: str = Field(alias="recordId", min_length=1)


async def handle_audio_chunking(
    input: JsonObject,
    config: JsonObject,
    progress: ProgressReporter,
    storage: MinioStorage,
) -> JsonObject:
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
            wav_paths = save_wav_chunks(wav, chunks, 16000, directory)

        wav_object_keys = [
            build_object_key(data.record_id, f"audio/chunk_{i}.wav")
            for i in range(len(chunks))
        ]

        async with progress.step("audio_chunking.save", False):
            manifest = build_manifest(chunks, duration, vad_object_key, wav_object_keys)
            await asyncio.to_thread(
                manifest_path.write_text,
                json.dumps(manifest),
                encoding="utf-8",
            )
            await asyncio.to_thread(
                vad_path.write_text, json.dumps(segments), encoding="utf-8"
            )

        async with progress.step("audio_chunking.upload", False):
            for i, path in enumerate(wav_paths):
                await storage.upload(path, wav_object_keys[i])
            await storage.upload(vad_path, vad_object_key)
            await storage.upload(manifest_path, manifest_object_key)

    return {"bucket": data.audio_source.bucket, "manifestKey": manifest_object_key}


def build_manifest(
    chunks: list[SpeechSegment],
    duration: float,
    vad_obj_key: str,
    chunk_keys: list[str],
):
    leading_removed = chunks[0]["start"] if chunks else duration
    trailing_removed = duration - chunks[-1]["end"] if chunks else 0
    return {
        "start_offset": leading_removed,
        "end_offset": trailing_removed,
        "vad_object_key": vad_obj_key,
        "chunks": [
            {
                "start": c["start"],
                "end": c["end"],
                "silence_after": c["removed_silence_after"],
                "chunk_object_key": chunk_keys[i],
            }
            for i, c in enumerate(chunks)
        ],
    }


def save_wav_chunks(
    wav: Tensor,
    chunks: list[SpeechSegment],
    sampling_rate: int,
    output_dir: Path,
) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)

    paths: list[Path] = []

    for index, chunk in enumerate(chunks):
        start = round(chunk["start"] * sampling_rate)
        end = round(chunk["end"] * sampling_rate)
        chunk_wav = wav[start:end]
        path = output_dir / f"chunk_{index:03d}.wav"
        torchaudio.save(
            path,
            chunk_wav.unsqueeze(0),
            sampling_rate,
            encoding="PCM_S",
            bits_per_sample=16,
        )

        paths.append(path)
    return paths
