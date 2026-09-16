import asyncio
from collections.abc import Callable
from concurrent.futures import Future
from pathlib import Path
from typing import Any

from worker.models import ProgressValue
from worker.services.whisper.models import (
    TranscriptionResult,
    TranscriptionSegment,
    WhisperConfig,
    WhisperProviderType,
)
from worker.services.whisper.provider import ProgressCallback, WhisperProvider
from worker.services.whisper.settings import WhisperSettings

type ModelKey = tuple[object, ...]
type SyncProgressCallback = Callable[[float], None]


class LocalWhisperProvider(WhisperProvider):
    def __init__(self, settings: WhisperSettings | None = None) -> None:
        self._settings = settings or WhisperSettings()
        self._models: dict[ModelKey, Any] = {}
        self._inference_locks: dict[ModelKey, asyncio.Lock] = {}
        self._models_lock = asyncio.Lock()

    @property
    def type(self) -> WhisperProviderType:
        return WhisperProviderType.LOCAL

    async def transcribe(
        self,
        wav_path: Path,
        config: WhisperConfig,
        progress: ProgressCallback | None = None,
    ) -> TranscriptionResult:
        model, inference_lock = await self._get_model(config)
        sync_progress: SyncProgressCallback | None = None
        if progress is not None:
            await progress(1)
            sync_progress = self._sync_progress_callback(
                progress,
                asyncio.get_running_loop(),
                initial_percent=1,
            )

        async with inference_lock:
            return await asyncio.to_thread(
                self._transcribe_sync,
                model,
                wav_path,
                config,
                sync_progress,
            )

    async def download_model(self, config: WhisperConfig) -> None:
        """Download and cache the requested faster-whisper model."""

        await self._get_model(config)

    async def _get_model(
        self,
        config: WhisperConfig,
    ) -> tuple[Any, asyncio.Lock]:
        key = self._model_key(config)
        async with self._models_lock:
            model = self._models.get(key)
            inference_lock = self._inference_locks.setdefault(key, asyncio.Lock())
            if model is None:
                model = await asyncio.to_thread(self._load_model, config)
                self._models[key] = model
        return model, inference_lock

    def _load_model(self, config: WhisperConfig) -> Any:
        # Keep the import lazy: remote providers do not initialize CTranslate2.
        from faster_whisper import WhisperModel

        return WhisperModel(
            config.model,
            device=self._device(),
            device_index=self._settings.local_device_index,
            compute_type=self._compute_type(),
            cpu_threads=self._settings.local_threads,
            download_root=(
                str(self._settings.local_download_root)
                if self._settings.local_download_root is not None
                else None
            ),
            local_files_only=self._settings.local_files_only,
            use_auth_token=self._hf_token(),
        )

    @staticmethod
    def _transcribe_sync(
        model: Any,
        wav_path: Path,
        config: WhisperConfig,
        progress: SyncProgressCallback | None,
    ) -> TranscriptionResult:
        raw_segments, info = model.transcribe(
            str(wav_path),
            language=config.language,
            task=config.task.value,
            temperature=config.temperature,
            initial_prompt=config.prompt,
            word_timestamps=False,
            vad_filter=False,
            condition_on_previous_text=False,
        )
        duration = max(float(info.duration), 0.0)
        segments: list[TranscriptionSegment] = []
        for segment in raw_segments:
            segments.append(
                TranscriptionSegment(
                    start=float(segment.start),
                    end=float(segment.end),
                    text=str(segment.text).strip(),
                )
            )
            if progress is not None and duration > 0:
                progress(min(float(segment.end) / duration * 100, 99))

        return TranscriptionResult(
            text=" ".join(segment.text for segment in segments).strip(),
            language=info.language,
            segments=tuple(segments),
        )

    @staticmethod
    def _sync_progress_callback(
        progress: ProgressCallback,
        loop: asyncio.AbstractEventLoop,
        initial_percent: int,
    ) -> SyncProgressCallback:
        last_percent = initial_percent

        def callback(value: float) -> None:
            nonlocal last_percent

            percent: ProgressValue = max(0, min(round(value), 100))
            if percent <= last_percent:
                return
            last_percent = int(percent)

            future: Future[None] = asyncio.run_coroutine_threadsafe(
                progress(percent),
                loop,
            )
            future.result()

        return callback

    def _model_key(self, config: WhisperConfig) -> ModelKey:
        return (
            config.model,
            self._device(),
            self._settings.local_device_index,
            self._settings.local_download_root,
            self._compute_type(),
            self._settings.local_threads,
            self._settings.local_files_only,
            self._hf_token(),
        )

    def _device(self) -> str:
        if self._settings.local_device is not None:
            return self._settings.local_device

        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"

    def _compute_type(self) -> str:
        configured = self._settings.local_compute_type
        if configured != "auto":
            return configured
        return "float16" if self._device() == "cuda" else "int8"

    def _hf_token(self) -> str | None:
        token = self._settings.local_hf_token
        return token.get_secret_value() if token is not None else None
