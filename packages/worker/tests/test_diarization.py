import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from worker.handlers.config import DynamicConfig
from worker.services.diarization import (
    DiarizationConfig,
    DiarizationResult,
    DiarizationService,
    DiarizationSettings,
    SpeakerSegment,
)


def test_dynamic_config_can_be_unpacked_into_diarization_config() -> None:
    dynamic = DynamicConfig.model_validate(
        {
            "preferSource": True,
            "chunking": {
                "targetDuration": 300,
                "minDuration": 120,
                "maxDuration": 600,
                "minGoodSilence": 2,
                "paddingBefore": 0.25,
                "paddingAfter": 0.25,
            },
            "voiceRecognition": {
                "provider": "local",
                "model": "turbo",
            },
            "diarization": {
                "model": "pyannote/custom-model",
                "token": "hf_secret",
                "minSpeakers": 2,
                "maxSpeakers": 5,
                "useExclusive": True,
            },
        }
    )

    config = DiarizationConfig(**dynamic.diarization.model_dump())

    assert config.model == "pyannote/custom-model"
    assert config.token == "hf_secret"
    assert config.min_speakers == 2
    assert config.max_speakers == 5
    assert config.use_exclusive is True
    assert "hf_secret" not in repr(config)


def test_diarization_pipeline_is_loaded_lazily_and_cached(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"RIFF-audio")
    loads: list[str] = []
    calls: list[tuple[str, dict[str, object]]] = []
    progress_values: list[float] = []

    class FakePipeline:
        def __call__(self, path: str, **options: Any) -> object:
            hook = options.pop("hook", None)
            if hook is not None:
                hook("segmentation", None)
                hook("speaker_counting", None)
                hook("embeddings", None, total=2, completed=0)
                hook("embeddings", None, total=2, completed=1)
                hook("embeddings", None, total=2, completed=2)
                hook("discrete_diarization", None)
            calls.append((path, options))
            exclusive = (
                (SimpleNamespace(start=0.126, end=1.234), "SPEAKER_00"),
                (SimpleNamespace(start=1.234, end=3.456), "SPEAKER_01"),
                (SimpleNamespace(start=3.456, end=4.567), "SPEAKER_00"),
            )
            return SimpleNamespace(
                exclusive_speaker_diarization=exclusive,
                speaker_diarization=(),
            )

    def load_pipeline(config: DiarizationConfig) -> Any:
        loads.append(config.model)
        return FakePipeline()

    async def report_progress(value: float) -> None:
        progress_values.append(value)

    async def run() -> tuple[DiarizationResult, DiarizationResult]:
        service = DiarizationService(DiarizationSettings(device="cpu"))
        monkeypatch.setattr(service, "_load_pipeline", load_pipeline)
        config = DiarizationConfig(
            model="pyannote/test-model",
            min_speakers=2,
            max_speakers=4,
        )
        return (
            await service.diarize(audio_path, config, progress=report_progress),
            await service.diarize(audio_path, config),
        )

    first, second = asyncio.run(run())

    assert first == second
    assert first.segments == (
        SpeakerSegment(start=0.126, end=1.234, speaker="SPEAKER_00"),
        SpeakerSegment(start=1.234, end=3.456, speaker="SPEAKER_01"),
        SpeakerSegment(start=3.456, end=4.567, speaker="SPEAKER_00"),
    )
    assert first.speakers == ("SPEAKER_00", "SPEAKER_01")
    assert loads == ["pyannote/test-model"]
    assert calls == [
        (str(audio_path), {"min_speakers": 2, "max_speakers": 4}),
        (str(audio_path), {"min_speakers": 2, "max_speakers": 4}),
    ]
    assert progress_values == [0, 1, 20, 25, 57, 90, 99, 100]


@pytest.mark.parametrize(
    "options",
    [
        {"num_speakers": 0},
        {"min_speakers": 3, "max_speakers": 2},
        {"num_speakers": 2, "min_speakers": 1},
    ],
)
def test_diarization_config_rejects_invalid_speaker_counts(
    options: dict[str, int],
) -> None:
    with pytest.raises(ValueError):
        DiarizationConfig(**options)
