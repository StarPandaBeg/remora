import asyncio
import base64
from pathlib import Path

import httpx

from worker.services.whisper.models import (
    TranscriptionResult,
    WhisperConfig,
    WhisperProviderType,
)
from worker.services.whisper.provider import HttpWhisperProvider, ProgressCallback
from worker.services.whisper.settings import WhisperSettings


class OpenRouterWhisperProvider(HttpWhisperProvider):
    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        settings: WhisperSettings | None = None,
    ) -> None:
        self._settings = settings or WhisperSettings()
        super().__init__(client, self._settings.timeout_seconds)

    @property
    def type(self) -> WhisperProviderType:
        return WhisperProviderType.OPENROUTER

    async def transcribe(
        self,
        wav_path: Path,
        config: WhisperConfig,
        progress: ProgressCallback | None = None,
    ) -> TranscriptionResult:
        if not config.openrouter_api_key:
            raise ValueError("OpenRouter openrouter_api_key is required")

        base_url = (
            config.openrouter_base_url or "https://openrouter.ai/api/v1"
        ).rstrip("/")
        headers = self._authorization_headers(config.openrouter_api_key)
        if self._settings.openrouter_site_url is not None:
            headers["HTTP-Referer"] = self._settings.openrouter_site_url
        if self._settings.openrouter_app_name is not None:
            headers["X-Title"] = self._settings.openrouter_app_name

        audio = await asyncio.to_thread(wav_path.read_bytes)
        payload: dict[str, object] = {
            "model": config.model,
            "input_audio": {
                "data": base64.b64encode(audio).decode("ascii"),
                "format": "wav",
            },
            "temperature": config.temperature,
        }
        if config.language is not None:
            payload["language"] = config.language

        response = await self._post(
            f"{base_url}/audio/transcriptions",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        return self._result_from_response(response)
