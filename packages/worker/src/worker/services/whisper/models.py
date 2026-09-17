from dataclasses import dataclass, field
from enum import StrEnum

from pydantic import SecretStr


class WhisperProviderType(StrEnum):
    LOCAL = "local"
    OLLAMA = "ollama"
    OPENROUTER = "openrouter"


class WhisperTask(StrEnum):
    TRANSCRIBE = "transcribe"
    TRANSLATE = "translate"


@dataclass(frozen=True, slots=True)
class WhisperConfig:
    """Runtime configuration for a single transcription request."""

    provider: WhisperProviderType
    model: str
    language: str | None = None
    prompt: str | None = None
    temperature: float = 0.0
    task: WhisperTask = WhisperTask.TRANSCRIBE
    parallel_tasks: int = 3
    ollama_base_url: str | None = None
    ollama_api_key: str | None = field(default=None, repr=False)
    openrouter_base_url: str | None = None
    openrouter_api_key: str | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        for name in (
            "ollama_base_url",
            "ollama_api_key",
            "openrouter_base_url",
            "openrouter_api_key",
        ):
            value = getattr(self, name)
            if isinstance(value, SecretStr):
                normalized = value.get_secret_value()
            elif value is not None:
                normalized = str(value)
            else:
                normalized = None
            object.__setattr__(self, name, normalized)

        if not self.model.strip():
            raise ValueError("Whisper model must not be empty")
        if not 0 <= self.temperature <= 1:
            raise ValueError("Whisper temperature must be between 0 and 1")
        if self.parallel_tasks < 1:
            raise ValueError("Whisper parallel_tasks must be positive")
        provider_urls = {
            "ollama_base_url": self.ollama_base_url,
            "openrouter_base_url": self.openrouter_base_url,
        }
        for name, value in provider_urls.items():
            if value is not None and not value.strip():
                raise ValueError(f"Whisper {name} must not be blank")


@dataclass(frozen=True, slots=True)
class TranscriptionWord:
    start: float
    end: float
    text: str
    score: float | None = None


@dataclass(frozen=True, slots=True)
class TranscriptionSegment:
    start: float
    end: float
    text: str
    words: tuple[TranscriptionWord, ...] = ()


@dataclass(frozen=True, slots=True)
class TranscriptionResult:
    text: str
    language: str | None = None
    segments: tuple[TranscriptionSegment, ...] = ()
