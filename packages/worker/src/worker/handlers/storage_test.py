from collections.abc import Awaitable, Callable
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from worker.models import JsonObject, ProgressValue, StorageReference
from worker.storage import MinioStorage, temporary_directory


class StorageTestInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    source: StorageReference
    destination_object_key: str = Field(
        alias="destinationObjectKey",
        min_length=1,
    )
    content_type: str = Field(
        default="application/octet-stream",
        alias="contentType",
        min_length=1,
    )


async def handle_storage_test(
    input: JsonObject,
    config: JsonObject,
    progress: Callable[[ProgressValue], Awaitable[None]],
    storage: MinioStorage,
) -> JsonObject:
    del config
    data = StorageTestInput.model_validate(input)

    async with temporary_directory() as directory:
        local_file = Path(directory, "object")
        await storage.download(data.source, local_file)
        await progress(50)
        reference = await storage.upload(
            local_file,
            data.destination_object_key,
            data.content_type,
        )

    return reference.model_dump(mode="json", by_alias=True)
