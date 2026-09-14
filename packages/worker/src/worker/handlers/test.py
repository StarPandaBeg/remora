from collections.abc import Awaitable, Callable

from worker.models import JsonObject, ProgressValue
from worker.storage import MinioStorage


async def handle_test(
    input: JsonObject,
    config: JsonObject,
    progress: Callable[[ProgressValue], Awaitable[None]],
    storage: MinioStorage,
) -> JsonObject:
    del config, storage

    await progress(25)
    if input.get("fail") is True:
        raise RuntimeError("Requested test handler failure")

    await progress(75)
    return {"message": "Test task completed"}

