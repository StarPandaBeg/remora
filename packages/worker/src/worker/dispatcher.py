import asyncio
import logging

import httpx
from pydantic import ValidationError

from worker.callbacks import CallbackSender
from worker.handlers import HANDLERS, Handler
from worker.models import (
    ExecuteTaskRequest,
    JsonObject,
    ProgressValue,
    WorkerEventCompleted,
    WorkerEventFailed,
    WorkerEventProgress,
    WorkerEventStarted,
)
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

    async def progress(value: ProgressValue) -> None:
        try:
            event = WorkerEventProgress(taskId=command.task_id, progress=value)
        except ValidationError:
            logger.error(
                "Handler produced invalid progress for taskId=%d",
                command.task_id,
                exc_info=True,
            )
            raise

        await _send_best_effort(sender, callback_url, event)

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
            "Handler failed for taskId=%d type=%s",
            command.task_id,
            command.type,
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
        "Task completed taskId=%d type=%s",
        command.task_id,
        command.type,
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
            "Unknown task type taskId=%d type=%s",
            command.task_id,
            command.type,
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
            "Task execution started taskId=%d type=%s",
            command.task_id,
            command.type,
        )
        await _run_handler(command, handler, sender, storage)
