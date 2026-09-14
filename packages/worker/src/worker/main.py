import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request, status

from worker.callbacks import CallbackSender
from worker.config import Settings, load_settings
from worker.dispatcher import execute_task
from worker.models import ExecuteTaskRequest, ExecuteTaskResponse
from worker.storage import MinioStorage

logger = logging.getLogger(__name__)


async def _execute_safely(
    command: ExecuteTaskRequest,
    sender: CallbackSender,
    semaphore: asyncio.Semaphore,
    storage: MinioStorage,
) -> None:
    try:
        await execute_task(command, sender, semaphore, storage)
    except Exception:
        logger.exception(
            "Unexpected background task error pipeline=%s type=%s taskId=%d",
            command.pipeline,
            command.type,
            command.task_id,
        )


def create_app(
    settings: Settings | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    storage: MinioStorage | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app_settings = settings or load_settings()
        client = httpx.AsyncClient(
            timeout=app_settings.http_timeout,
            transport=transport,
        )
        app.state.callback_sender = CallbackSender(client, app_settings)
        app.state.storage = storage or MinioStorage(app_settings)
        app.state.semaphore = asyncio.Semaphore(
            app_settings.max_concurrent_tasks
        )
        app.state.tasks = set()

        try:
            yield
        finally:
            tasks: set[asyncio.Task[None]] = app.state.tasks
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            await client.aclose()

    application = FastAPI(title="Remora Worker", lifespan=lifespan)

    @application.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.post(
        "/tasks/execute",
        response_model=ExecuteTaskResponse,
        status_code=status.HTTP_202_ACCEPTED,
    )
    async def submit_task(
        command: ExecuteTaskRequest,
        request: Request,
    ) -> ExecuteTaskResponse:
        logger.info(
            "Task accepted pipeline=%s type=%s taskId=%d",
            command.pipeline,
            command.type,
            command.task_id,
        )
        task = asyncio.create_task(
            _execute_safely(
                command,
                request.app.state.callback_sender,
                request.app.state.semaphore,
                request.app.state.storage,
            ),
            name=f"task-{command.task_id}",
        )
        tasks: set[asyncio.Task[None]] = request.app.state.tasks
        tasks.add(task)
        task.add_done_callback(tasks.discard)
        return ExecuteTaskResponse()

    return application


app = create_app()
