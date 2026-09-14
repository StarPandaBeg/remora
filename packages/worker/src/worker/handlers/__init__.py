from collections.abc import Awaitable, Callable

from worker.handlers.media_prepare import handle_media_prepare
from worker.handlers.storage_test import handle_storage_test
from worker.handlers.test import handle_test
from worker.models import JsonObject, ProgressValue
from worker.storage import MinioStorage

type ProgressReporter = Callable[[ProgressValue], Awaitable[None]]
type Handler = Callable[
    [JsonObject, JsonObject, ProgressReporter, MinioStorage],
    Awaitable[JsonObject],
]

HANDLERS: dict[str, Handler] = {
    "media_prepare": handle_media_prepare,
    "test": handle_test,
    "test.storage": handle_storage_test,
}
