import asyncio
import logging

import httpx

from worker.callbacks import CallbackSender
from worker.handlers import HANDLERS, Handler
from worker.models import (
    ExecuteTaskRequest,
    WorkerEventCompleted,
    WorkerEventFailed,
    WorkerEventProgress,
    WorkerEventStarted,
)
from worker.progress import ProgressReporter
from worker.storage import MinioStorage

logger = logging.getLogger(__name__)


async def _send_best_effort(
    sender: CallbackSender,
    callback_url: str,
    event: WorkerEventStarted | WorkerEventProgress,
) -> None:
    try:
        await sender.send_event(callback_url, event)
    except httpx.HTTPError:
        logger.warning(
            "Best-effort callback failed for taskId=%d event=%s",
            event.task_id,
            event.type,
            exc_info=True,
        )


async def _send_final(
    sender: CallbackSender,
    callback_url: str,
    event: WorkerEventCompleted | WorkerEventFailed,
) -> None:
    try:
        await sender.send_event(callback_url, event)
    except httpx.HTTPError:
        logger.error(
            "Final callback delivery failed for taskId=%d event=%s",
            event.task_id,
            event.type,
            exc_info=True,
        )


async def _run_handler(
    command: ExecuteTaskRequest,
    handler: Handler,
    sender: CallbackSender,
    storage: MinioStorage,
) -> None:
    callback_url = str(command.callback_url)
    await _send_best_effort(
        sender,
        callback_url,
        WorkerEventStarted(taskId=command.task_id),
    )

    async def send_progress(event: WorkerEventProgress) -> None:
        await _send_best_effort(sender, callback_url, event)

    progress = ProgressReporter(command.task_id, send_progress)

    try:
        output = await handler(command.input, command.config, progress, storage)
        if not isinstance(output, dict):
            raise TypeError("Handler output must be an object")
        completed_event = WorkerEventCompleted(
            taskId=command.task_id,
            output=output,
        )
    except Exception:
        logger.exception(
            "Handler failed pipeline=%s type=%s taskId=%d",
            command.pipeline,
            command.type,
            command.task_id,
        )
        await _send_final(
            sender,
            callback_url,
            WorkerEventFailed(
                taskId=command.task_id,
                error={
                    "code": "HANDLER_ERROR",
                    "message": "Task execution failed",
                },
            ),
        )
        return

    await _send_final(
        sender,
        callback_url,
        completed_event,
    )
    logger.info(
        "Task completed pipeline=%s type=%s taskId=%d",
        command.pipeline,
        command.type,
        command.task_id,
    )


async def execute_task(
    command: ExecuteTaskRequest,
    sender: CallbackSender,
    semaphore: asyncio.Semaphore,
    storage: MinioStorage,
) -> None:
    handler = HANDLERS.get(command.type)
    callback_url = str(command.callback_url)

    if handler is None:
        logger.warning(
            "Unknown task type pipeline=%s type=%s taskId=%d",
            command.pipeline,
            command.type,
            command.task_id,
        )
        await _send_final(
            sender,
            callback_url,
            WorkerEventFailed(
                taskId=command.task_id,
                error={
                    "code": "UNKNOWN_TASK_TYPE",
                    "message": f"Unknown task type: {command.type}",
                },
            ),
        )
        return

    async with semaphore:
        logger.info(
            "Task execution started pipeline=%s type=%s taskId=%d",
            command.pipeline,
            command.type,
            command.task_id,
        )
        await _run_handler(command, handler, sender, storage)
