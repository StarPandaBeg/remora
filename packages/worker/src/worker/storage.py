import asyncio
import shutil
import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from minio import Minio

from worker.config import Settings
from worker.models import StorageReference


class MinioStorage:
    def __init__(
        self,
        settings: Settings,
        client: Minio | None = None,
    ) -> None:
        self._bucket = settings.minio_bucket
        self._client = client or Minio(
            endpoint=f"{settings.minio_endpoint}:{settings.minio_port}",
            access_key=settings.minio_access_key.get_secret_value(),
            secret_key=settings.minio_secret_key.get_secret_value(),
            secure=settings.minio_use_ssl,
            region=settings.minio_region,
        )

    async def download(
        self,
        reference: StorageReference,
        destination: Path,
    ) -> Path:
        await asyncio.to_thread(
            destination.parent.mkdir,
            parents=True,
            exist_ok=True,
        )
        await asyncio.to_thread(
            self._client.fget_object,
            reference.bucket,
            reference.object_key,
            str(destination),
        )
        return destination

    async def upload(
        self,
        source: Path,
        object_key: str,
        content_type: str = "application/octet-stream",
    ) -> StorageReference:
        if not object_key:
            raise ValueError("object_key must not be empty")

        await asyncio.to_thread(
            self._client.fput_object,
            self._bucket,
            object_key,
            str(source),
            content_type=content_type,
        )
        return StorageReference(bucket=self._bucket, objectKey=object_key)

    async def delete(self, reference: StorageReference) -> None:
        await asyncio.to_thread(
            self._client.remove_object,
            reference.bucket,
            reference.object_key,
        )


@asynccontextmanager
async def temporary_directory() -> AsyncIterator[Path]:
    path = Path(await asyncio.to_thread(tempfile.mkdtemp, prefix="remora-worker-"))
    try:
        yield path
    finally:
        await asyncio.to_thread(shutil.rmtree, path, ignore_errors=True)

