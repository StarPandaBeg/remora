import asyncio
import itertools
from collections.abc import Awaitable, Callable
from concurrent.futures import Future
from dataclasses import dataclass

from silero_vad import get_speech_timestamps, load_silero_vad, read_audio
from torch import Tensor

from worker.models import ProgressValue

type ProgressCallback = Callable[[ProgressValue], Awaitable[None]]
type SyncProgressCallback = Callable[[float], None]
type SpeechSegmentRaw = dict[str, float]
type SpeechSegment = dict[str, float]


@dataclass
class ChunkingConfig:
    target_duration: float
    min_duration: float
    max_duration: float
    min_good_silence: float
    padding_before: float
    padding_after: float


model = load_silero_vad(onnx=True)
_model_lock = asyncio.Lock()


def _sync_progress_callback(
    progress: ProgressCallback,
    loop: asyncio.AbstractEventLoop,
) -> SyncProgressCallback:
    """Adapt Silero's synchronous callback to our async progress callback."""

    last_percent = -1

    def callback(value: float) -> None:
        nonlocal last_percent

        percent = max(0, min(round(value), 100))
        if percent <= last_percent:
            return
        last_percent = percent

        async def report_progress() -> None:
            await progress(percent)

        future: Future[None] = asyncio.run_coroutine_threadsafe(
            report_progress(),
            loop,
        )
        future.result()

    return callback


def _get_wav_segments_sync(
    path: str,
    sampling_rate: int,
    progress: SyncProgressCallback | None,
) -> tuple[Tensor, list[SpeechSegmentRaw]]:
    wav = read_audio(path, sampling_rate)

    try:
        if progress is None:
            segments = get_speech_timestamps(
                wav,
                model,
                sampling_rate=sampling_rate,
                return_seconds=True,
            )
        else:
            segments = get_speech_timestamps(
                wav,
                model,
                sampling_rate=sampling_rate,
                return_seconds=True,
                progress_tracking_callback=progress,
            )
    finally:
        model.reset_states()

    return wav, segments


async def get_wav_segments(
    path: str,
    sampling_rate: int = 16000,
    progress: ProgressCallback | None = None,
) -> tuple[Tensor, list[SpeechSegmentRaw]]:
    loop = asyncio.get_running_loop()
    sync_progress = (
        _sync_progress_callback(progress, loop) if progress is not None else None
    )
    async with _model_lock:
        return await asyncio.to_thread(
            _get_wav_segments_sync,
            path,
            sampling_rate,
            sync_progress,
        )


def build_chunks(
    segments: list[SpeechSegmentRaw], duration: float, config: ChunkingConfig
) -> list[SpeechSegment]:
    if not segments:
        return []
    speech = _segments_to_speech(segments)
    gaps = _calculate_gaps(speech)

    chunks = []

    first_speech_start = speech[0]["start"]
    final_speech_end = speech[-1]["end"]

    # Это реальное начало текущего чанка
    current_chunk_start = max(
        0,
        first_speech_start - config.padding_before,
    )
    current_reference_start = first_speech_start

    while current_reference_start < final_speech_end:
        remaining = final_speech_end - current_reference_start

        # Остаток уже помещается в один chunk
        if remaining <= config.max_duration:
            chunk_end = min(
                duration,
                final_speech_end + config.padding_after,
            )
            chunks.append(
                {
                    "start": current_chunk_start,
                    "end": chunk_end,
                    "duration": chunk_end - current_chunk_start,
                    "cut_reason": "last",
                    "removed_silence_after": 0.0,
                }
            )
            break

        min_cut = current_reference_start + config.min_duration
        target_cut = current_reference_start + config.target_duration
        max_cut = current_reference_start + config.max_duration

        candidates = [gap for gap in gaps if min_cut <= gap["cut"] <= max_cut]
        good_candidates = [
            gap for gap in candidates if gap["duration"] >= config.min_good_silence
        ]

        selected_gap = None
        reason = "unknown"
        if good_candidates:

            def score(gap):
                distance_from_target = abs(gap["cut"] - target_cut)
                silence_bonus = gap["duration"] * 30
                return distance_from_target - silence_bonus

            selected_gap = min(
                good_candidates,
                key=score,
            )
            reason = f"silence {selected_gap['duration']:.2f}s"

        elif candidates:
            selected_gap = min(
                candidates,
                key=lambda gap: abs(gap["cut"] - target_cut),
            )
            reason = f"short silence {selected_gap['duration']:.2f}s"

        if selected_gap is not None:
            chunk_end = min(
                duration,
                selected_gap["speech_end"] + config.padding_after,
            )
            next_chunk_start = max(
                0,
                selected_gap["next_speech_start"] - config.padding_before,
            )
            removed_silence = max(
                0.0,
                next_chunk_start - chunk_end,
            )

            chunks.append(
                {
                    "start": current_chunk_start,
                    "end": chunk_end,
                    "duration": chunk_end - current_chunk_start,
                    "cut_reason": reason,
                    "removed_silence_after": removed_silence,
                }
            )

            current_chunk_start = next_chunk_start
            current_reference_start = selected_gap["next_speech_start"]

        else:
            # Жёсткий fallback:
            # вообще нет VAD gap между MIN и MAX.
            #
            # Тут уже режем по времени.
            chunk_end = min(
                duration,
                max_cut,
            )

            chunks.append(
                {
                    "start": current_chunk_start,
                    "end": chunk_end,
                    "duration": chunk_end - current_chunk_start,
                    "cut_reason": "hard limit",
                    "removed_silence_after": 0.0,
                }
            )
            current_chunk_start = max_cut
            current_reference_start = max_cut
    return chunks


def _segments_to_speech(segments: list[SpeechSegmentRaw]) -> list[SpeechSegment]:
    return [
        {
            "start": float(segment["start"]),
            "end": float(segment["end"]),
        }
        for segment in segments
    ]


def _calculate_gaps(speech: list[SpeechSegment]):
    # gap хранит не только середину паузы,
    # но и реальные границы речи вокруг неё
    gaps = []
    for previous, current in itertools.pairwise(speech):
        speech_end = previous["end"]
        next_speech_start = current["start"]
        if next_speech_start <= speech_end:
            continue

        gaps.append(
            {
                "speech_end": speech_end,
                "next_speech_start": next_speech_start,
                "duration": next_speech_start - speech_end,
                "cut": (speech_end + next_speech_start) / 2,
            }
        )
    return gaps
