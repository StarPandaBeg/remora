import asyncio
import json
import mimetypes
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from worker.models import JsonObject, ProgressValue, StorageReference
from worker.storage import MinioStorage, temporary_directory


@dataclass
class MediaInfo:
    width: int | None
    height: int | None
    fps: float | None
    duration: float | None

    video_codec: str | None

    has_audio: bool
    audio_codec: str | None
    audio_sample_rate: int | None
    audio_channels: int | None


class MediaPrepareInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    source: StorageReference
    record_id: str = Field(alias="recordId", min_length=1)
    mimetype: str = Field(min_length=1)


async def handle_media_prepare(
    input: JsonObject,
    config: JsonObject,
    progress: Callable[[ProgressValue], Awaitable[None]],
    storage: MinioStorage,
) -> JsonObject:
    data = MediaPrepareInput.model_validate(input)
    extension = mimetypes.guess_extension(data.mimetype) or '.mp4' 

    async with temporary_directory() as directory:
        source = directory / f"source{extension}"
        destination = directory / "result.mp4"
        destinationAudio = directory / "result.wav"

        videoObjectKey = f"entries/files/{data.record_id}/encoded.mp4"
        audioObjectKey = f"entries/files/{data.record_id}/encoded.wav"

        await storage.download(data.source, source)
        await progress(20)

        media = await probe_media(source)
        await progress(30)

        await normalize_video(source, destination, media)
        await progress(50)
        await extract_audio(source, destinationAudio, media)
        await progress(70)
        
        await storage.upload(destination, videoObjectKey)
        await progress(85)
        await storage.upload(destination, audioObjectKey)
        await progress(100)
        
    return {
        "bucket": data.source.bucket,
        "videoObjectKey": videoObjectKey,
        "audioObjectKey": audioObjectKey,
    }

async def probe_media(source_file: Path) -> MediaInfo:
    process = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v", "error",
        "-show_entries",
        (
            "format=duration:"
            "stream=index,codec_type,codec_name,width,height,"
            "avg_frame_rate,sample_rate,channels"
        ),
        "-of", "json",
        str(source_file),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        raise RuntimeError(
            f"ffprobe failed: {stderr.decode()}"
        )

    data = json.loads(stdout)
    streams = data.get("streams", [])
    video_stream = next(
        (
            stream
            for stream in streams
            if stream.get("codec_type") == "video"
        ),
        None,
    )
    audio_stream = next(
        (
            stream
            for stream in streams
            if stream.get("codec_type") == "audio"
        ),
        None,
    )

    fps = None
    if video_stream:
        frame_rate = video_stream.get("avg_frame_rate")
        if frame_rate and frame_rate != "0/0":
            numerator, denominator = map(int, frame_rate.split("/"))
            if denominator != 0:
                fps = numerator / denominator

    duration = data.get("format", {}).get("duration")
    return MediaInfo(
        width=video_stream.get("width") if video_stream else None,
        height=video_stream.get("height") if video_stream else None,
        fps=fps,
        duration=float(duration) if duration else None,
        video_codec=(
            video_stream.get("codec_name")
            if video_stream
            else None
        ),
        has_audio=audio_stream is not None,
        audio_codec=(
            audio_stream.get("codec_name")
            if audio_stream
            else None
        ),
        audio_sample_rate=(
            int(audio_stream["sample_rate"])
            if audio_stream and audio_stream.get("sample_rate")
            else None
        ),
        audio_channels=(
            audio_stream.get("channels")
            if audio_stream
            else None
        ),
    )


async def normalize_video(
    source: Path,
    dest: Path,
    media: MediaInfo,
) -> None:
    filters = [
        r"scale=min(1920\,iw):-2:force_original_aspect_ratio=decrease"
    ]

    if media.fps is not None and media.fps > 60:
        filters.append("fps=60")

    args = [
        "ffmpeg",
        "-i", str(source),

        "-map", "0:v:0",
    ]

    if media.has_audio:
        args += [
            "-map", "0:a:0",
        ]

    args += [
        "-vf", ",".join(filters),
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
    ]

    if media.has_audio:
        args += [
            "-c:a", "aac",
            "-b:a", "128k",
            "-ar", "48000",
        ]

    args += [
        "-movflags", "+faststart",
        "-y",
        str(dest),
    ]

    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await process.communicate()
    if process.returncode != 0:
        raise RuntimeError(
            f"ffmpeg normalize failed: {stderr.decode()}"
        )

async def extract_audio(
    source: Path,
    dest: Path,
    media: MediaInfo,
) -> None:
    if not media.has_audio:
        raise RuntimeError("Media file has no audio stream")

    process = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-i", str(source),
        "-map", "0:a:0",
        "-vn",
        "-c:a", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        "-y",
        str(dest),

        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await process.communicate()

    if process.returncode != 0:
        raise RuntimeError(
            f"ffmpeg audio extraction failed: {stderr.decode()}"
        )