import asyncio
import logging

import httpx

from worker.config import Settings
from worker.models import WorkerEvent

logger = logging.getLogger(__name__)

FINAL_EVENT_TYPES = {"task.completed", "task.failed"}


class CallbackSender:
    def __init__(self, client: httpx.AsyncClient, settings: Settings) -> None:
        self._client = client
        self._headers = {
            "x-worker-secret": settings.worker_secret.get_secret_value()
        }
        self._retry_count = settings.final_event_retry_count
        self._retry_base_delay = settings.final_event_retry_base_delay

    async def send_event(self, callback_url: str, event: WorkerEvent) -> None:
        attempts = self._retry_count if event.type in FINAL_EVENT_TYPES else 1
        payload = event.model_dump(mode="json", by_alias=True, exclude_none=True)

        for attempt in range(1, attempts + 1):
            try:
                response = await self._client.post(
                    callback_url,
                    json=payload,
                    headers=self._headers,
                )
                response.raise_for_status()
                return
            except httpx.HTTPError:
                if attempt == attempts:
                    raise

                delay = self._retry_base_delay * (2 ** (attempt - 1))
                logger.warning(
                    "Callback attempt %d/%d failed for taskId=%d event=%s; "
                    "retrying in %.2fs",
                    attempt,
                    attempts,
                    event.task_id,
                    event.type,
                    delay,
                    exc_info=True,
                )
                await asyncio.sleep(delay)
