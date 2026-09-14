from collections.abc import Awaitable, Callable
from typing import TypeAlias

from worker.handlers.storage_test import handle_storage_test
from worker.handlers.test import handle_test
from worker.models import JsonObject, ProgressValue
from worker.storage import MinioStorage

ProgressReporter: TypeAlias = Callable[[ProgressValue], Awaitable[None]]
Handler: TypeAlias = Callable[
    [JsonObject, JsonObject, ProgressReporter, MinioStorage],
    Awaitable[JsonObject],
]

HANDLERS: dict[str, Handler] = {
    "test": handle_test,
    "test.storage": handle_storage_test,
}
