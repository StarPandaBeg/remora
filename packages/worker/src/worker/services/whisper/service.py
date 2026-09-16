from collections.abc import Iterable
from pathlib import Path

import httpx

from worker.services.whisper.local import LocalWhisperProvider
from worker.services.whisper.models import (
    TranscriptionResult,
    WhisperConfig,
    WhisperProviderType,
)
from worker.services.whisper.ollama import OllamaWhisperProvider
from worker.services.whisper.openrouter import OpenRouterWhisperProvider
from worker.services.whisper.provider import ProgressCallback, WhisperProvider
from worker.services.whisper.settings import WhisperSettings


class WhisperService:
    """Dispatch each transcription to its runtime-selected provider."""

    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        providers: Iterable[WhisperProvider] | None = None,
        settings: WhisperSettings | None = None,
    ) -> None:
        app_settings = settings or WhisperSettings()
        configured_providers = (
            providers
            if providers is not None
            else (
                LocalWhisperProvider(app_settings),
                OllamaWhisperProvider(client, app_settings),
                OpenRouterWhisperProvider(client, app_settings),
            )
        )
        self._providers = {
            provider.type: provider for provider in configured_providers
        }

    async def transcribe(
        self,
        wav_path: Path,
        config: WhisperConfig,
        progress: ProgressCallback | None = None,
    ) -> TranscriptionResult:
        if wav_path.suffix.lower() != ".wav":
            raise ValueError("WhisperService accepts WAV files only")

        provider = self._providers.get(config.provider)
        if provider is None:
            raise ValueError(f"Whisper provider is not configured: {config.provider}")

        if progress is not None:
            await progress(0)
        result = await provider.transcribe(wav_path, config, progress)
        if progress is not None:
            await progress(100)
        return result

    async def download_local_model(self, config: WhisperConfig) -> None:
        if config.provider is not WhisperProviderType.LOCAL:
            raise ValueError("download_local_model requires the local provider")

        provider = self._providers.get(WhisperProviderType.LOCAL)
        if not isinstance(provider, LocalWhisperProvider):
            raise RuntimeError("Local Whisper provider is not configured")
        await provider.download_model(config)
