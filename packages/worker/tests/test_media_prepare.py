import asyncio
from typing import cast

from worker.handlers.media_prepare import handle_media_prepare
from worker.models import ProgressValue, WorkerEventCompleted
from worker.storage import MinioStorage


def test_media_prepare_output_is_json_compatible() -> None:
    progress_values: list[ProgressValue] = []

    async def progress(value: ProgressValue) -> None:
        progress_values.append(value)

    async def run_handler() -> dict[str, object]:
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
            },
            {},
            progress,
            cast(MinioStorage, None),
        )

    output = asyncio.run(run_handler())
    event = WorkerEventCompleted(taskId=3, output=output)

    assert progress_values == [100]
    assert event.model_dump(mode="json", by_alias=True)["output"] == {
        "ok": True,
        "data": {
            "source": {
                "bucket": "remora",
                "objectKey": (
                    "entries/files/7c42a03d-8ee3-4434-a934-48d6b410bcbf/"
                    "original.mp4"
                ),
            },
            "recordId": "7c42a03d-8ee3-4434-a934-48d6b410bcbf",
        },
        "config": {},
    }
