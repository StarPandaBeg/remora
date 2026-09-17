import asyncio
from collections.abc import Awaitable, Callable, Mapping
from concurrent.futures import Future
from pathlib import Path
from typing import Any

from worker.models import ProgressValue
from worker.services.diarization.models import (
    DiarizationConfig,
    DiarizationResult,
    SpeakerSegment,
)
from worker.services.diarization.settings import DiarizationSettings

type PipelineKey = tuple[str, str | None, str, Path | None]
type ProgressCallback = Callable[[ProgressValue], Awaitable[None]]
type PipelineHook = Callable[..., None]


class DiarizationService:
    """Load pyannote pipelines lazily and diarize audio outside the event loop."""

    def __init__(self, settings: DiarizationSettings | None = None) -> None:
        self._settings = settings or DiarizationSettings()
        self._pipelines: dict[PipelineKey, Any] = {}
        self._inference_locks: dict[PipelineKey, asyncio.Lock] = {}
        self._pipelines_lock = asyncio.Lock()

    async def diarize(
        self,
        audio_path: Path,
        config: DiarizationConfig,
        progress: ProgressCallback | None = None,
    ) -> DiarizationResult:
        if progress is not None:
            await progress(0)
        pipeline, inference_lock = await self._get_pipeline(config)
        hook: PipelineHook | None = None
        if progress is not None:
            await progress(1)
            hook = self._progress_hook(
                progress,
                asyncio.get_running_loop(),
                initial_percent=1,
            )

        async with inference_lock:
            result = await asyncio.to_thread(
                self._diarize_sync,
                pipeline,
                audio_path,
                config,
                hook,
            )
        if progress is not None:
            await progress(100)
        return result

    async def download_model(self, config: DiarizationConfig) -> None:
        """Download and cache the requested pyannote pipeline."""

        await self._get_pipeline(config)

    async def _get_pipeline(
        self,
        config: DiarizationConfig,
    ) -> tuple[Any, asyncio.Lock]:
        key = self._pipeline_key(config)
        async with self._pipelines_lock:
            pipeline = self._pipelines.get(key)
            inference_lock = self._inference_locks.setdefault(key, asyncio.Lock())
            if pipeline is None:
                pipeline = await asyncio.to_thread(self._load_pipeline, config)
                self._pipelines[key] = pipeline
        return pipeline, inference_lock

    def _load_pipeline(self, config: DiarizationConfig) -> Any:
        import torch
        from pyannote.audio import Pipeline

        pipeline = Pipeline.from_pretrained(
            config.model,
            token=config.token,
            cache_dir=self._settings.cache_dir,
        )
        if pipeline is None:
            raise RuntimeError(
                f"Unable to load diarization pipeline: {config.model}"
            )
        pipeline.to(torch.device(self._device()))
        return pipeline

    @staticmethod
    def _diarize_sync(
        pipeline: Any,
        audio_path: Path,
        config: DiarizationConfig,
        hook: PipelineHook | None,
    ) -> DiarizationResult:
        options: dict[str, object] = {
            name: value
            for name, value in (
                ("num_speakers", config.num_speakers),
                ("min_speakers", config.min_speakers),
                ("max_speakers", config.max_speakers),
            )
            if value is not None
        }
        if hook is not None:
            options["hook"] = hook
        output = pipeline(str(audio_path), **options)
        diarization = (
            getattr(output, "exclusive_speaker_diarization", None)
            if config.use_exclusive
            else None
        )
        if diarization is None:
            diarization = getattr(output, "speaker_diarization", None)
        if diarization is None:
            raise RuntimeError("Diarization pipeline returned no speaker timeline")

        return DiarizationResult(
            segments=tuple(
                SpeakerSegment(
                    start=round(float(turn.start), 3),
                    end=round(float(turn.end), 3),
                    speaker=str(speaker),
                )
                for turn, speaker in diarization
            )
        )

    @staticmethod
    def _progress_hook(
        progress: ProgressCallback,
        loop: asyncio.AbstractEventLoop,
        initial_percent: int,
    ) -> PipelineHook:
        last_percent = initial_percent

        def hook(
            step_name: str,
            _step_artifact: Any,
            file: Mapping[str, Any] | None = None,
            total: int | None = None,
            completed: int | None = None,
        ) -> None:
            del file
            nonlocal last_percent

            percent = DiarizationService._pipeline_percent(
                step_name,
                completed,
                total,
            )
            if percent is None or percent <= last_percent:
                return
            last_percent = percent

            async def report_progress() -> None:
                await progress(percent)

            future: Future[None] = asyncio.run_coroutine_threadsafe(
                report_progress(),
                loop,
            )
            future.result()

        return hook

    @staticmethod
    def _pipeline_percent(
        step_name: str,
        completed: int | None,
        total: int | None,
    ) -> int | None:
        if step_name == "segmentation":
            return 20
        if step_name == "speaker_counting":
            return 25
        if step_name == "embeddings":
            if total is None or total <= 0 or completed is None:
                return 90
            ratio = max(0.0, min(completed / total, 1.0))
            return 25 + round(ratio * 65)
        if step_name == "discrete_diarization":
            return 99
        return None

    def _pipeline_key(self, config: DiarizationConfig) -> PipelineKey:
        return (
            config.model,
            config.token,
            self._device(),
            self._settings.cache_dir,
        )

    def _device(self) -> str:
        if self._settings.device is not None:
            return self._settings.device

        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
