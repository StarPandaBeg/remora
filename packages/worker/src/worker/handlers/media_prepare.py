import mimetypes
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from worker.models import JsonObject, StorageReference
from worker.progress import ProgressReporter
from worker.services.ffmpeg import MediaInfo, ProgressCallback, probe_media, run_ffmpeg
from worker.services.util import build_object_key
from worker.storage import MinioStorage, temporary_directory


class MediaPrepareInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    source: StorageReference
    record_id: str = Field(alias="recordId", min_length=1)
    mimetype: str = Field(min_length=1)


async def handle_media_prepare(
    input: JsonObject,
    config: JsonObject,
    progress: ProgressReporter,
    storage: MinioStorage,
) -> JsonObject:
    data = MediaPrepareInput.model_validate(input)
    extension = mimetypes.guess_extension(data.mimetype) or ".mp4"

    await progress.set_total_steps(5)

    async with temporary_directory() as directory:
        source = directory / f"source{extension}"
        destination = directory / "result.mp4"
        destinationAudio = directory / "result.wav"

        video_object_key = build_object_key(data.record_id, "encoded.mp4")
        audio_object_key = build_object_key(data.record_id, "encoded.wav")

        async with progress.step("media_prepare.download", False):
            await storage.download(data.source, source)

        async with progress.step("media_prepare.probe", False):
            media = await probe_media(source)

        async with progress.step("media_prepare.video") as step:
            await normalize_video(source, destination, media, progress=step)
        async with progress.step("media_prepare.audio") as step:
            await extract_audio(source, destinationAudio, media, progress=step)

        async with progress.step("media_prepare.upload", False):
            await storage.upload(destination, video_object_key)
            await storage.upload(destination, audio_object_key)

    return {
        "bucket": data.source.bucket,
        "videoObjectKey": video_object_key,
        "audioObjectKey": audio_object_key,
    }


async def normalize_video(
    source: Path,
    dest: Path,
    media: MediaInfo,
    progress: ProgressCallback | None = None,
) -> None:
    filters = [r"scale=min(1920\,iw):-2:force_original_aspect_ratio=decrease"]
    if media.fps is not None and media.fps > 60:
        filters.append("fps=60")
    args = [
        "ffmpeg",
        "-i",
        str(source),
        "-map",
        "0:v:0",
        *(["-map", "0:a:0"] if media.has_audio else []),
        "-vf",
        ",".join(filters),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        *(["-c:a", "aac", "-b:a", "128k", "-ar", "48000"] if media.has_audio else []),
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:1",
        "-nostats",
        "-y",
        str(dest),
    ]
    await run_ffmpeg(args, media.duration, progress)


async def extract_audio(
    source: Path,
    dest: Path,
    media: MediaInfo,
    progress: ProgressCallback | None = None,
) -> None:
    if not media.has_audio:
        raise RuntimeError("Media file has no audio stream")

    args = [
        "ffmpeg",
        "-i",
        str(source),
        "-map",
        "0:a:0",
        "-vn",
        "-c:a",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-y",
        str(dest),
    ]
    await run_ffmpeg(args, media.duration, progress)
