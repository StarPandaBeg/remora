import asyncio
import json
import mimetypes
from collections.abc import Awaitable, Callable
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from worker.models import JsonObject, ProgressValue, StorageReference
from worker.storage import MinioStorage, temporary_directory


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

        objectKey = f"entries/files/{data.record_id}/encoded.mp4"

        await storage.download(data.source, source)
        await progress(20)
        await normalize_video(source, destination)
        await progress(80)
        await storage.upload(destination, objectKey)
        await progress(100)
        
    return {
        "bucket": data.source.bucket,
        "videoObjectKey": objectKey
    }

async def get_video_fps(source_file: Path) -> float:
    process = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=avg_frame_rate",
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

    frame_rate = data["streams"][0]["avg_frame_rate"]
    numerator, denominator = map(int, frame_rate.split("/"))

    if denominator == 0:
        raise RuntimeError("Invalid video frame rate")

    return numerator / denominator

async def normalize_video(
    source_file: Path,
    result_file: Path,
):
    fps = await get_video_fps(source_file)
    filters = [
        r"scale=min(1920\,iw):-2:force_original_aspect_ratio=decrease"
    ]
    if fps > 60:
        filters.append("fps=60")

    process = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-i", str(source_file),

        "-map", "0:v:0",
        "-map", "0:a:0?",

        "-vf", ",".join(filters),

        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "23",
        "-pix_fmt", "yuv420p",

        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "48000",

        "-movflags", "+faststart",
        "-y",

        str(result_file),

        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    stdout, stderr = await process.communicate()

    if process.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed: {stderr.decode()}"
        )
