import asyncio
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from worker.handlers.audio_chunking import AudioManifest
from worker.handlers.config import DynamicConfig
from worker.models import JsonObject, StorageReference
from worker.progress import ProgressReporter
from worker.services.diarization.models import DiarizationConfig, DiarizationResult
from worker.services.ffmpeg import cut_wav
from worker.services.registry import get_diarization, get_storage, get_whisper
from worker.services.util import build_object_key
from worker.services.whisper import WhisperConfig
from worker.services.whisper.models import TranscriptionResult
from worker.services.whisper.provider import ProgressCallback
from worker.storage import temporary_directory


class VoiceRecognitionInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    audio_source: StorageReference = Field(alias="audioSource")
    manifest_source: StorageReference = Field(alias="manifestSource")
    record_id: str = Field(alias="recordId", min_length=1)


@dataclass(frozen=True)
class TranscriptionEntry:
    start: float
    end: float
    text: str
    chunk_id: int
    person: str | None


async def handle_voice_recognition(
    input: JsonObject,
    config: JsonObject,
    progress: ProgressReporter,
) -> JsonObject:
    storage = get_storage()

    data = VoiceRecognitionInput.model_validate(input)
    cfg = DynamicConfig.model_validate(config)
    voice_config = WhisperConfig(**cfg.voice_recognition.model_dump())
    diarize_config = DiarizationConfig(**cfg.diarization.model_dump())

    await progress.set_total_steps(5 if diarize_config.enabled else 4)
    async with temporary_directory() as directory:
        audio_path = directory / "source.wav"
        manifest_path = directory / "manifest.json"
        transcription_path = directory / "transcription.json"

        transcription_object_key = build_object_key(
            data.record_id, "transcription.json"
        )

        async with progress.step("voice_recognition.download", False):
            await storage.download(data.audio_source, audio_path)
            await storage.download(data.manifest_source, manifest_path)
            manifest = await load_manifest(manifest_path)
            if not len(manifest.chunks):
                raise RuntimeError("Empty audio")
            chunk_paths = await cut_source_wav(
                audio_path, manifest, directory / "chunks"
            )

        async with progress.step("voice_recognition.recognition") as step:
            transcriptions = await transcribe_all(chunk_paths, voice_config, step)

        speakers: DiarizationResult | None = None
        if diarize_config.enabled:
            di_service = get_diarization()
            async with progress.step("voice_recognition.diarize") as step:
                speakers = await di_service.diarize(audio_path, diarize_config, step)

        async with progress.step("voice_recognition.merge", False):
            transcription = merge_transcriptions(transcriptions, manifest, speakers)
            json_data = (
                TypeAdapter(list[TranscriptionEntry]).dump_json(transcription).decode()
            )
            await asyncio.to_thread(
                transcription_path.write_text,
                json_data,
                encoding="utf-8",
            )

        async with progress.step("voice_recognition.upload", False):
            await storage.upload(transcription_path, transcription_object_key)

    return {
        "bucket": data.audio_source.bucket,
        "language": transcriptions[0].language,
        "transcriptionKey": transcription_object_key,
    }


async def cut_source_wav(
    audio_path: Path,
    manifest: AudioManifest,
    directory: Path,
):
    paths = []
    for i, chunk in enumerate(manifest.chunks):
        target_path = directory / f"chunk_{i}.wav"
        await cut_wav(audio_path, chunk.start, chunk.end, target_path)
        paths.append(target_path)
    return paths


async def load_manifest(path: Path) -> AudioManifest:
    contents = await asyncio.to_thread(path.read_bytes)
    return AudioManifest.model_validate_json(contents)


async def transcribe_all(
    paths,
    wconfig: WhisperConfig,
    progress: ProgressCallback | None = None,
):
    semaphore = asyncio.Semaphore(wconfig.parallel_tasks)
    whisper = get_whisper()

    total = len(paths)
    completed = 0

    async def transcribe_chunk(path):
        nonlocal completed
        async with semaphore:
            result = await whisper.transcribe(path, wconfig)
        completed += 1
        if progress:
            await progress(int(completed / total * 100))
        return result

    return await asyncio.gather(*(transcribe_chunk(path) for path in paths))


def merge_transcriptions(
    transcriptions: list[TranscriptionResult],
    manifest: AudioManifest,
    speakers: DiarizationResult | None,
):
    if len(transcriptions) != len(manifest.chunks):
        raise RuntimeError("Transcription Error")

    result: list[TranscriptionEntry] = []
    speaker_segments = speakers.segments if speakers else ()
    speaker_index = 0

    for i, chunk in enumerate(manifest.chunks):
        transcription = transcriptions[i]
        for segment in transcription.segments:
            start = round(segment.start + chunk.start, 3)
            end = round(segment.end + chunk.start, 3)

            while (
                speaker_index < len(speaker_segments)
                and speaker_segments[speaker_index].end <= start
            ):
                speaker_index += 1

            best_speaker = None
            best_overlap = 0.0
            j = speaker_index

            while j < len(speaker_segments) and speaker_segments[j].start < end:
                speaker = speaker_segments[j]
                overlap = min(end, speaker.end) - max(start, speaker.start)
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_speaker = speaker.speaker
                j += 1

            result.append(
                TranscriptionEntry(
                    start=round(segment.start + chunk.start, 3),
                    end=round(segment.end + chunk.start, 3),
                    text=segment.text,
                    chunk_id=i,
                    person=best_speaker,
                )
            )
    return result
