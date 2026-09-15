import asyncio
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from worker.models import ProgressValue

type ProgressCallback = Callable[[ProgressValue], Awaitable[None]]

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

async def run_ffmpeg(
    args: list[str],
    duration: float | None = None,
    progress: ProgressCallback | None = None,
) -> None:
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    assert process.stdout is not None
    assert process.stderr is not None

    stderr_task = asyncio.create_task(process.stderr.read())
    last_percent = -1

    async for raw_line in process.stdout:
        line = raw_line.decode().strip()
        key, _, value = line.partition("=")

        if key == "out_time_us" and duration is not None:
          try:
              current_seconds = int(value) / 1_000_000
          except ValueError:
              continue
          percent = int(min(current_seconds / duration * 100, 100))
          if progress is not None and percent > last_percent:
              last_percent = percent
              await progress(percent)

    stderr = await stderr_task
    returncode = await process.wait()

    if returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed: {stderr.decode()}"
        )

    if progress is not None and last_percent < 100:
        await progress(100)

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