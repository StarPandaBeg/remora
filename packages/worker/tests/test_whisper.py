import asyncio
import base64
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from worker.handlers.config import OllamaWhisperConfig, OpenRouterWhisperConfig
from worker.services.whisper import (
    LocalWhisperProvider,
    TranscriptionResult,
    WhisperConfig,
    WhisperProviderType,
    WhisperService,
    WhisperSettings,
)


def test_pydantic_whisper_config_can_be_unpacked_into_service_config() -> None:
    ollama_input = OllamaWhisperConfig(
        model="whisper",
        ollamaBaseUrl="http://ollama.test:11434",
        ollamaApiKey="ollama-secret",
    )
    ollama_config = WhisperConfig(**ollama_input.model_dump())

    assert ollama_config.ollama_base_url == "http://ollama.test:11434/"
    assert ollama_config.ollama_api_key == "ollama-secret"

    openrouter_input = OpenRouterWhisperConfig(
        model="openai/whisper-1",
        openrouterApiKey="openrouter-secret",
    )
    openrouter_config = WhisperConfig(**openrouter_input.model_dump())

    assert openrouter_config.openrouter_base_url == (
        "https://openrouter.ai/api/v1"
    )
    assert openrouter_config.openrouter_api_key == "openrouter-secret"
    assert "openrouter-secret" not in repr(openrouter_config)


def test_openrouter_transcription(tmp_path: Path) -> None:
    wav_path = tmp_path / "audio.wav"
    wav_path.write_bytes(b"RIFF-audio")

    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://openrouter.test/api/v1/audio/transcriptions"
        assert request.headers["Authorization"] == "Bearer secret"
        payload = json.loads(request.content)
        assert payload["model"] == "openai/whisper-1"
        assert base64.b64decode(payload["input_audio"]["data"]) == b"RIFF-audio"
        assert payload["input_audio"]["format"] == "wav"
        return httpx.Response(200, json={"text": " Hello ", "language": "en"})

    async def run() -> TranscriptionResult:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(respond)
        ) as client:
            service = WhisperService(client)
            return await service.transcribe(
                wav_path,
                WhisperConfig(
                    provider=WhisperProviderType.OPENROUTER,
                    model="openai/whisper-1",
                    openrouter_api_key="secret",
                    openrouter_base_url="https://openrouter.test/api/v1",
                ),
            )

    assert asyncio.run(run()) == TranscriptionResult(text="Hello", language="en")


def test_ollama_can_pull_and_transcribe(tmp_path: Path) -> None:
    wav_path = tmp_path / "audio.wav"
    wav_path.write_bytes(b"RIFF-audio")
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/api/pull":
            assert json.loads(request.content) == {
                "model": "audio-model",
                "stream": False,
            }
            return httpx.Response(200, json={"status": "success"})
        assert request.url.path == "/v1/audio/transcriptions"
        assert b'audio-model' in request.content
        assert b'RIFF-audio' in request.content
        return httpx.Response(200, json={"text": " transcript "})

    async def run() -> TranscriptionResult:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(respond)
        ) as client:
            return await WhisperService(
                client,
                settings=WhisperSettings(ollama_pull_model=True),
            ).transcribe(
                wav_path,
                WhisperConfig(
                    provider=WhisperProviderType.OLLAMA,
                    model="audio-model",
                    ollama_base_url="http://ollama.test",
                ),
            )

    assert asyncio.run(run()) == TranscriptionResult(text="transcript")
    assert len(requests) == 2


def test_local_model_is_loaded_lazily_and_cached(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wav_path = tmp_path / "audio.wav"
    wav_path.write_bytes(b"RIFF-audio")
    loads: list[str] = []
    progress_values: list[float] = []

    class FakeModel:
        def transcribe(self, audio: object, **options: Any) -> tuple[object, object]:
            assert audio == str(wav_path)
            assert options["language"] == "ru"
            assert options["word_timestamps"] is False
            assert options["vad_filter"] is False
            assert options["condition_on_previous_text"] is False
            segments = (
                SimpleNamespace(
                    start=0,
                    end=1.25,
                    text=" Привет ",
                    words=None,
                ),
            )
            return segments, SimpleNamespace(language="ru", duration=2.5)

    def load_model(config: WhisperConfig) -> FakeModel:
        loads.append(config.model)
        return FakeModel()

    async def report_progress(value: float) -> None:
        progress_values.append(value)

    async def run() -> tuple[TranscriptionResult, TranscriptionResult]:
        provider = LocalWhisperProvider(
            WhisperSettings(local_device="cpu", local_compute_type="int8")
        )
        monkeypatch.setattr(provider, "_load_model", load_model)
        service = WhisperService(providers=[provider])
        config = WhisperConfig(
            provider=WhisperProviderType.LOCAL,
            model="tiny",
            language="ru",
        )
        return (
            await service.transcribe(wav_path, config, progress=report_progress),
            await service.transcribe(wav_path, config),
        )

    first, second = asyncio.run(run())
    assert first == second
    assert first.text == "Привет"
    assert first.segments[0].end == 1.25
    assert first.segments[0].words == ()
    assert loads == ["tiny"]
    assert progress_values == [0, 1, 50, 100]


def test_local_provider_loads_faster_whisper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}
    sentinel = object()

    def load_model(model: str, **options: object) -> object:
        captured["model"] = model
        captured.update(options)
        return sentinel

    monkeypatch.setattr("faster_whisper.WhisperModel", load_model)
    config = WhisperConfig(
        provider=WhisperProviderType.LOCAL,
        model="large-v3",
        language="ru",
    )

    provider = LocalWhisperProvider(
        WhisperSettings(local_device="cpu", local_compute_type="int8")
    )
    assert provider._load_model(config) is sentinel
    assert captured["model"] == "large-v3"
    assert captured["device"] == "cpu"
    assert captured["compute_type"] == "int8"
    assert captured["cpu_threads"] == 4


def test_openrouter_requires_api_key(tmp_path: Path) -> None:
    wav_path = tmp_path / "audio.wav"
    wav_path.write_bytes(b"RIFF-audio")

    async def run() -> None:
        with pytest.raises(ValueError, match="openrouter_api_key"):
            await WhisperService().transcribe(
                wav_path,
                WhisperConfig(
                    provider=WhisperProviderType.OPENROUTER,
                    model="openai/whisper-1",
                ),
            )

    asyncio.run(run())


def test_whisper_settings_are_loaded_from_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("WHISPER_LOCAL_DEVICE", "cuda")
    monkeypatch.setenv("WHISPER_LOCAL_FILES_ONLY", "true")
    monkeypatch.setenv("WHISPER_OPENROUTER_APP_NAME", "Remora Desktop")

    settings = WhisperSettings(_env_file=None)

    assert settings.local_device == "cuda"
    assert settings.local_files_only is True
    assert settings.openrouter_app_name == "Remora Desktop"
