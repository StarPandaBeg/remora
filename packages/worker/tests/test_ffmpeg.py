import asyncio
from pathlib import Path

import pytest

import worker.services.ffmpeg as ffmpeg


def test_cut_wav_builds_expected_command(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "audio.wav"
    destination = tmp_path / "chunks" / "chunk.wav"
    captured: dict[str, object] = {}

    async def run(
        args: list[str],
        duration: float | None = None,
        progress: ffmpeg.ProgressCallback | None = None,
    ) -> None:
        captured.update(args=args, duration=duration, progress=progress)

    async def report(_value: float) -> None:
        pass

    monkeypatch.setattr(ffmpeg, "run_ffmpeg", run)
    result = asyncio.run(
        ffmpeg.cut_wav(source, 325.85, 644.35, destination, report)
    )

    assert result == destination
    assert destination.parent.is_dir()
    assert captured == {
        "args": [
            "ffmpeg",
            "-ss",
            "325.85",
            "-to",
            "644.35",
            "-i",
            str(source),
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-progress",
            "pipe:1",
            "-nostats",
            "-y",
            str(destination),
        ],
        "duration": 318.5,
        "progress": report,
    }


@pytest.mark.parametrize(
    ("start", "end"),
    [(-1, 5), (5, 5), (6, 5), (float("nan"), 5), (0, float("inf"))],
)
def test_cut_wav_rejects_invalid_range(
    tmp_path: Path,
    start: float,
    end: float,
) -> None:
    with pytest.raises(ValueError):
        asyncio.run(
            ffmpeg.cut_wav(
                tmp_path / "audio.wav",
                start,
                end,
                tmp_path / "chunk.wav",
            )
        )
