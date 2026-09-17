import asyncio
from pathlib import Path

import httpx

from worker.services.whisper.models import (
    TranscriptionResult,
    WhisperConfig,
    WhisperProviderType,
)
from worker.services.whisper.provider import HttpWhisperProvider, ProgressCallback
from worker.services.whisper.settings import WhisperSettings


class OllamaWhisperProvider(HttpWhisperProvider):
    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        settings: WhisperSettings | None = None,
    ) -> None:
        self._settings = settings or WhisperSettings()
        super().__init__(client, self._settings.timeout_seconds)

    @property
    def type(self) -> WhisperProviderType:
        return WhisperProviderType.OLLAMA

    async def transcribe(
        self,
        wav_path: Path,
        config: WhisperConfig,
        progress: ProgressCallback | None = None,
    ) -> TranscriptionResult:
        base_url = (
            config.ollama_base_url or "http://localhost:11434"
        ).rstrip("/")
        headers = self._authorization_headers(config.ollama_api_key)

        if self._settings.ollama_pull_model:
            response = await self._post(
                f"{base_url}/api/pull",
                headers=headers,
                json={"model": config.model, "stream": False},
            )
            response.raise_for_status()

        audio = await asyncio.to_thread(wav_path.read_bytes)
        data = {"model": config.model, "response_format": "json"}
        if config.language is not None:
            data["language"] = config.language
        if config.prompt is not None:
            data["prompt"] = config.prompt

        response = await self._post(
            f"{base_url}/v1/audio/transcriptions",
            headers=headers,
            data=data,
            files={"file": (wav_path.name, audio, "audio/wav")},
        )
        response.raise_for_status()
        return self._result_from_response(response)
