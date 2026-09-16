from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import httpx

from worker.models import ProgressValue
from worker.services.whisper.models import (
    TranscriptionResult,
    WhisperConfig,
    WhisperProviderType,
)

type ProgressCallback = Callable[[ProgressValue], Awaitable[None]]


class WhisperProvider(ABC):
    @property
    @abstractmethod
    def type(self) -> WhisperProviderType:
        """Provider type used by the runtime dispatcher."""

    @abstractmethod
    async def transcribe(
        self,
        wav_path: Path,
        config: WhisperConfig,
        progress: ProgressCallback | None = None,
    ) -> TranscriptionResult:
        """Transcribe a WAV file."""


class HttpWhisperProvider(WhisperProvider):
    def __init__(
        self,
        client: httpx.AsyncClient | None,
        timeout_seconds: float,
    ) -> None:
        self._client = client
        self._timeout_seconds = timeout_seconds

    async def _post(
        self,
        url: str,
        **kwargs: Any,
    ) -> httpx.Response:
        if self._client is not None:
            return await self._client.post(
                url,
                timeout=self._timeout_seconds,
                **kwargs,
            )

        async with httpx.AsyncClient() as client:
            return await client.post(
                url,
                timeout=self._timeout_seconds,
                **kwargs,
            )

    @staticmethod
    def _authorization_headers(api_key: str | None) -> dict[str, str]:
        return {"Authorization": f"Bearer {api_key}"} if api_key else {}

    @staticmethod
    def _result_from_response(response: httpx.Response) -> TranscriptionResult:
        payload = response.json()
        text = payload.get("text")
        if not isinstance(text, str):
            raise ValueError("Transcription provider returned no text")
        language = payload.get("language")
        return TranscriptionResult(
            text=text.strip(),
            language=language if isinstance(language, str) else None,
        )
