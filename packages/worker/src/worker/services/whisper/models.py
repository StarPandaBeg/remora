from dataclasses import dataclass, field
from enum import StrEnum


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
    base_url: str | None = None
    api_key: str | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        if not self.model.strip():
            raise ValueError("Whisper model must not be empty")
        if not 0 <= self.temperature <= 1:
            raise ValueError("Whisper temperature must be between 0 and 1")
        if self.base_url is not None and not self.base_url.strip():
            raise ValueError("Whisper base_url must not be blank")


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
