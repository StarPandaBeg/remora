from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class DiarizationSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    device: str | None = Field(
        default=None,
        validation_alias="DIARIZATION_DEVICE",
    )
    cache_dir: Path | None = Field(
        default=None,
        validation_alias="DIARIZATION_CACHE_DIR",
    )

    @field_validator("device", "cache_dir", mode="before")
    @classmethod
    def blank_optional_value_is_none(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value
