import asyncio
from pathlib import Path

import pytest

import worker.handlers.media_prepare as media_prepare
from worker.handlers.media_prepare import MediaInfo, handle_media_prepare
from worker.models import (
    StorageReference,
    WorkerEventCompleted,
    WorkerEventProgress,
)
from worker.progress import ProgressReporter


class FakeStorage:
    def __init__(self) -> None:
        self.uploads: list[tuple[Path, str]] = []

    async def download(
        self,
        _reference: StorageReference,
        destination: Path,
    ) -> Path:
        destination.write_bytes(b"source")
        return destination

    async def upload(
        self,
        source: Path,
        object_key: str,
        _content_type: str = "application/octet-stream",
    ) -> StorageReference:
        self.uploads.append((source, object_key))
        return StorageReference(bucket="remora", objectKey=object_key)


def test_media_prepare_output_is_json_compatible(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    progress_events: list[WorkerEventProgress] = []
    storage = FakeStorage()

    async def probe(_source: Path) -> MediaInfo:
        return MediaInfo(
            width=1920,
            height=1080,
            fps=30,
            duration=10,
            video_codec="h264",
            has_audio=True,
            audio_codec="aac",
            audio_sample_rate=48_000,
            audio_channels=2,
        )

    async def process(
        _source: Path,
        destination: Path,
        _media: MediaInfo,
        **_options: object,
    ) -> None:
        destination.write_bytes(b"result")

    monkeypatch.setattr(media_prepare, "probe_media", probe)
    monkeypatch.setattr(media_prepare, "normalize_video", process)
    monkeypatch.setattr(media_prepare, "extract_audio", process)
    monkeypatch.setattr(media_prepare, "get_storage", lambda: storage)

    async def send_progress(event: WorkerEventProgress) -> None:
        progress_events.append(event)

    async def run_handler() -> dict[str, object]:
        progress = ProgressReporter(task_id=3, send_event=send_progress)
        return await handle_media_prepare(
            {
                "source": {
                    "bucket": "remora",
                    "objectKey": (
                        "entries/files/7c42a03d-8ee3-4434-a934-48d6b410bcbf/"
                        "original.mp4"
                    ),
                },
                "recordId": "7c42a03d-8ee3-4434-a934-48d6b410bcbf",
                "mimetype": "video/mp4",
            },
            {},
            progress,
        )

    output = asyncio.run(run_handler())
    event = WorkerEventCompleted(taskId=3, output=output)

    assert [item.progress for item in progress_events] == [20, 30, 50, 70, 85, 100]
    assert event.model_dump(mode="json", by_alias=True)["output"] == {
        "bucket": "remora",
        "videoObjectKey": (
            "entries/files/7c42a03d-8ee3-4434-a934-48d6b410bcbf/encoded.mp4"
        ),
        "audioObjectKey": (
            "entries/files/7c42a03d-8ee3-4434-a934-48d6b410bcbf/encoded.wav"
        ),
    }
    assert [object_key for _, object_key in storage.uploads] == [
        "entries/files/7c42a03d-8ee3-4434-a934-48d6b410bcbf/encoded.mp4",
        "entries/files/7c42a03d-8ee3-4434-a934-48d6b410bcbf/encoded.wav",
    ]
