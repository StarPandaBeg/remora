import asyncio

import pytest

from worker.models import WorkerEventProgress
from worker.progress import ProgressReporter


def serialize(event: WorkerEventProgress) -> dict[str, object]:
    return event.model_dump(mode="json", by_alias=True, exclude_none=True)


def test_plain_progress_remains_supported() -> None:
    events: list[WorkerEventProgress] = []

    async def send(event: WorkerEventProgress) -> None:
        events.append(event)

    reporter = ProgressReporter(task_id=42, send_event=send)

    asyncio.run(reporter(35))

    assert serialize(events[0]) == {
        "type": "task.progress",
        "taskId": 42,
        "progress": 35.0,
    }


def test_step_progress_keeps_context_and_calculates_overall_progress() -> None:
    events: list[WorkerEventProgress] = []

    async def send(event: WorkerEventProgress) -> None:
        events.append(event)

    async def report() -> None:
        progress = ProgressReporter(task_id=7, send_event=send)
        await progress.set_total_steps(2)
        await progress.start_step("Download")
        await progress.update_step(50)
        await progress.complete_step()
        await progress.start_step("Process")
        await progress.complete_step()

    asyncio.run(report())

    payloads = [serialize(event) for event in events]
    assert payloads == [
        {
            "type": "task.progress",
            "taskId": 7,
            "progress": 0.0,
            "totalSteps": 2,
        },
        {
            "type": "task.progress",
            "taskId": 7,
            "progress": 0.0,
            "totalSteps": 2,
            "step": 1,
            "stepName": "Download",
            "stepProgress": 0.0,
        },
        {
            "type": "task.progress",
            "taskId": 7,
            "progress": 25.0,
            "totalSteps": 2,
            "step": 1,
            "stepName": "Download",
            "stepProgress": 50.0,
        },
        {
            "type": "task.progress",
            "taskId": 7,
            "progress": 50.0,
            "totalSteps": 2,
            "step": 1,
            "stepName": "Download",
            "stepProgress": 100.0,
        },
        {
            "type": "task.progress",
            "taskId": 7,
            "progress": 50.0,
            "totalSteps": 2,
            "step": 2,
            "stepName": "Process",
            "stepProgress": 0.0,
        },
        {
            "type": "task.progress",
            "taskId": 7,
            "progress": 100.0,
            "totalSteps": 2,
            "step": 2,
            "stepName": "Process",
            "stepProgress": 100.0,
        },
    ]
    assert all(payload["totalSteps"] == 2 for payload in payloads)


def test_step_methods_validate_their_lifecycle() -> None:
    async def discard(_event: WorkerEventProgress) -> None:
        pass

    async def report() -> None:
        progress = ProgressReporter(task_id=1, send_event=discard)

        with pytest.raises(RuntimeError, match="set_total_steps"):
            await progress.start_step("Download")
        with pytest.raises(ValueError, match="positive integer"):
            await progress.set_total_steps(0)

        await progress.set_total_steps(1)
        await progress.start_step("Download")
        with pytest.raises(ValueError):
            await progress.update_step(101)
        await progress.complete_step()
        with pytest.raises(ValueError, match="already been started"):
            await progress.start_step("Extra")

    asyncio.run(report())
