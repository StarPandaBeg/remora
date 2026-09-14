from pydantic import Field, SecretStr, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    worker_secret: SecretStr = Field(validation_alias="WORKER_SECRET")
    minio_endpoint: str = Field(
        default="127.0.0.1",
        min_length=1,
        validation_alias="MINIO_ENDPOINT",
    )
    minio_port: int = Field(
        default=9000,
        ge=1,
        le=65_535,
        validation_alias="MINIO_PORT",
    )
    minio_use_ssl: bool = Field(
        default=False,
        validation_alias="MINIO_USE_SSL",
    )
    minio_access_key: SecretStr = Field(validation_alias="MINIO_ACCESS_KEY")
    minio_secret_key: SecretStr = Field(validation_alias="MINIO_SECRET_KEY")
    minio_bucket: str = Field(
        default="remora",
        min_length=3,
        max_length=63,
        pattern=r"^[a-z0-9][a-z0-9.-]*[a-z0-9]$",
        validation_alias="MINIO_BUCKET",
    )
    minio_region: str = Field(
        default="us-east-1",
        min_length=1,
        validation_alias="MINIO_REGION",
    )
    max_concurrent_tasks: int = Field(
        default=2,
        ge=1,
        validation_alias="MAX_CONCURRENT_TASKS",
    )
    http_timeout: float = Field(
        default=10.0,
        gt=0,
        validation_alias="HTTP_TIMEOUT",
    )
    final_event_retry_count: int = Field(
        default=3,
        ge=1,
        validation_alias="FINAL_EVENT_RETRY_COUNT",
    )
    final_event_retry_base_delay: float = Field(
        default=0.25,
        ge=0,
        validation_alias="FINAL_EVENT_RETRY_BASE_DELAY",
    )

    @field_validator(
        "worker_secret",
        "minio_access_key",
        "minio_secret_key",
    )
    @classmethod
    def secret_must_not_be_blank(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().strip():
            raise ValueError("secret settings must not be empty")
        return value


def load_settings() -> Settings:
    try:
        return Settings()  # type: ignore[call-arg]
    except ValidationError as exc:
        raise RuntimeError(
            "Invalid worker configuration: WORKER_SECRET and MinIO credentials "
            "must be set, and worker settings must contain valid values"
        ) from exc
