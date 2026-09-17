from dataclasses import dataclass

from worker.services.diarization import DiarizationService
from worker.services.whisper import WhisperService
from worker.storage import MinioStorage


@dataclass(frozen=True, slots=True)
class ApplicationServices:
    storage: MinioStorage
    whisper: WhisperService
    diarization: DiarizationService


_services: ApplicationServices | None = None


def initialize_services(
    storage: MinioStorage,
    whisper: WhisperService,
    diarization: DiarizationService,
) -> ApplicationServices:
    global _services

    if _services is not None:
        raise RuntimeError("Application services are already initialized")
    _services = ApplicationServices(
        storage=storage,
        whisper=whisper,
        diarization=diarization,
    )
    return _services


def get_services() -> ApplicationServices:
    if _services is None:
        raise RuntimeError("Application services are not initialized")
    return _services


def get_storage() -> MinioStorage:
    return get_services().storage


def get_whisper() -> WhisperService:
    return get_services().whisper


def get_diarization() -> DiarizationService:
    return get_services().diarization


def shutdown_services(services: ApplicationServices) -> None:
    global _services

    if _services is services:
        _services = None
