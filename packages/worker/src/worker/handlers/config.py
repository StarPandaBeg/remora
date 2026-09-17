from typing import Annotated, Literal

from pydantic import (
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    model_validator,
)

from worker.services.whisper.models import WhisperProviderType, WhisperTask


class _DiarizationConfig(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        extra="ignore",
        validate_default=True,
    )

    enabled: bool = False
    model: str = Field(
        default="pyannote/speaker-diarization-community-1",
        min_length=1,
    )
    token: SecretStr | None = None
    num_speakers: int | None = Field(default=None, alias="numSpeakers", ge=1)
    min_speakers: int | None = Field(default=None, alias="minSpeakers", ge=1)
    max_speakers: int | None = Field(default=None, alias="maxSpeakers", ge=1)
    use_exclusive: bool = Field(default=True, alias="useExclusive")

    @model_validator(mode="after")
    def validate_speaker_counts(self) -> "_DiarizationConfig":
        if self.num_speakers is not None and (
            self.min_speakers is not None or self.max_speakers is not None
        ):
            raise ValueError(
                "numSpeakers cannot be combined with minSpeakers or maxSpeakers"
            )
        if (
            self.min_speakers is not None
            and self.max_speakers is not None
            and self.min_speakers > self.max_speakers
        ):
            raise ValueError("minSpeakers must not exceed maxSpeakers")
        return self


class _BaseWhisperConfig(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        extra="ignore",
        validate_default=True,
    )

    model: str = Field(min_length=1)
    language: str | None = None
    prompt: str | None = None
    temperature: float = Field(default=0.0, ge=0, le=1)
    task: WhisperTask = WhisperTask.TRANSCRIBE
    parallel_tasks: int = Field(alias="parallelTasks", default=3, ge=1)


class LocalWhisperConfig(_BaseWhisperConfig):
    provider: Literal[WhisperProviderType.LOCAL] = WhisperProviderType.LOCAL


class OllamaWhisperConfig(_BaseWhisperConfig):
    provider: Literal[WhisperProviderType.OLLAMA] = WhisperProviderType.OLLAMA
    ollama_base_url: AnyHttpUrl = Field(
        default=AnyHttpUrl("http://localhost:11434"),
        alias="ollamaBaseUrl",
    )
    ollama_api_key: SecretStr | None = Field(
        default=None,
        alias="ollamaApiKey",
    )


class OpenRouterWhisperConfig(_BaseWhisperConfig):
    provider: Literal[WhisperProviderType.OPENROUTER] = WhisperProviderType.OPENROUTER
    openrouter_base_url: AnyHttpUrl = Field(
        default=AnyHttpUrl("https://openrouter.ai/api/v1"),
        alias="openrouterBaseUrl",
    )
    openrouter_api_key: SecretStr = Field(alias="openrouterApiKey")


type WhisperConfig = Annotated[
    LocalWhisperConfig | OllamaWhisperConfig | OpenRouterWhisperConfig,
    Field(discriminator="provider"),
]


class _ChunkingConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    target_duration: float = Field(alias="targetDuration")
    min_duration: float = Field(alias="minDuration")
    max_duration: float = Field(alias="maxDuration")
    min_good_silence: float = Field(alias="minGoodSilence")
    padding_before: float = Field(alias="paddingBefore")
    padding_after: float = Field(alias="paddingAfter")


class DynamicConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    prefer_source: bool = Field(alias="preferSource")
    chunking: _ChunkingConfig
    voice_recognition: WhisperConfig = Field(alias="voiceRecognition")
    diarization: _DiarizationConfig = Field(default_factory=_DiarizationConfig)
