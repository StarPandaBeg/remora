from collections.abc import Awaitable, Callable

from worker.handlers.audio_chunking import handle_audio_chunking
from worker.handlers.media_prepare import handle_media_prepare
from worker.handlers.voice_recognition import handle_voice_recognition
from worker.models import JsonObject
from worker.progress import ProgressReporter

type Handler = Callable[
    [JsonObject, JsonObject, ProgressReporter],
    Awaitable[JsonObject],
]

HANDLERS: dict[str, Handler] = {
    "media_prepare": handle_media_prepare,
    "audio_chunking": handle_audio_chunking,
    "voice_recognition": handle_voice_recognition,
}
