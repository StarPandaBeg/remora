from pathlib import Path
from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class WhisperSettings(BaseSettings):
    """Infrastructure settings loaded from environment or a local .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    timeout_seconds: float = Field(
        default=300.0,
        gt=0,
        validation_alias="WHISPER_TIMEOUT_SECONDS",
    )

    local_device: str | None = Field(
        default=None,
        validation_alias="WHISPER_LOCAL_DEVICE",
    )
    local_device_index: int = Field(
        default=0,
        ge=0,
        validation_alias="WHISPER_LOCAL_DEVICE_INDEX",
    )
    local_download_root: Path | None = Field(
        default=None,
        validation_alias="WHISPER_LOCAL_DOWNLOAD_ROOT",
    )
    local_compute_type: str = Field(
        default="auto",
        min_length=1,
        validation_alias="WHISPER_LOCAL_COMPUTE_TYPE",
    )
    local_threads: int = Field(
        default=4,
        ge=1,
        validation_alias="WHISPER_LOCAL_THREADS",
    )
    local_files_only: bool = Field(
        default=False,
        validation_alias="WHISPER_LOCAL_FILES_ONLY",
    )
    local_hf_token: SecretStr | None = Field(
        default=None,
        validation_alias="WHISPER_LOCAL_HF_TOKEN",
    )
    ollama_pull_model: bool = Field(
        default=False,
        validation_alias="WHISPER_OLLAMA_PULL_MODEL",
    )

    openrouter_site_url: str | None = Field(
        default=None,
        validation_alias="WHISPER_OPENROUTER_SITE_URL",
    )
    openrouter_app_name: str | None = Field(
        default=None,
        validation_alias="WHISPER_OPENROUTER_APP_NAME",
    )

    @field_validator(
        "local_device",
        "local_download_root",
        "local_hf_token",
        "openrouter_site_url",
        "openrouter_app_name",
        mode="before",
    )
    @classmethod
    def blank_optional_value_is_none(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value
