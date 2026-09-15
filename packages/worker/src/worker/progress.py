from collections.abc import Awaitable, Callable

from worker.models import ProgressValue, WorkerEventProgress

SendProgressEvent = Callable[[WorkerEventProgress], Awaitable[None]]


class ProgressReporter:
    """Reports either plain progress or progress split into numbered steps."""

    def __init__(self, task_id: int, send_event: SendProgressEvent) -> None:
        self._task_id = task_id
        self._send_event = send_event
        self._progress = 0.0
        self._total_steps: int | None = None
        self._step: int | None = None
        self._step_name: str | None = None
        self._step_progress: float | None = None

    async def __call__(self, progress: ProgressValue) -> None:
        await self._emit(progress)

    async def set_total_steps(self, total_steps: int) -> None:
        if isinstance(total_steps, bool) or total_steps < 1:
            raise ValueError("total_steps must be a positive integer")

        self._progress = 0.0
        self._total_steps = total_steps
        self._step = None
        self._step_name = None
        self._step_progress = None
        await self._emit(self._progress)

    async def start_step(self, step_name: str | None = None) -> None:
        if self._total_steps is None:
            raise RuntimeError("set_total_steps() must be called before start_step()")
        if step_name is not None and not step_name:
            raise ValueError("step_name must not be empty")

        next_step = 1 if self._step is None else self._step + 1
        if next_step > self._total_steps:
            raise ValueError("all configured steps have already been started")

        self._step = next_step
        self._step_name = step_name
        self._step_progress = 0.0
        await self._emit(self._step_base_progress())

    async def update_step(self, step_progress: ProgressValue) -> None:
        if self._step is None or self._total_steps is None:
            raise RuntimeError("start_step() must be called before update_step()")

        event = self._event(
            self._step_base_progress()
            + float(step_progress) / self._total_steps,
            step_progress=float(step_progress),
        )
        self._step_progress = event.step_progress
        self._progress = event.progress
        await self._send_event(event)

    async def complete_step(self) -> None:
        await self.update_step(100)

    def _step_base_progress(self) -> float:
        assert self._step is not None
        assert self._total_steps is not None
        return (self._step - 1) * 100 / self._total_steps

    def _event(
        self,
        progress: ProgressValue,
        *,
        step_progress: float | None = None,
    ) -> WorkerEventProgress:
        return WorkerEventProgress(
            taskId=self._task_id,
            progress=progress,
            totalSteps=self._total_steps,
            step=self._step,
            stepName=self._step_name,
            stepProgress=(
                self._step_progress if step_progress is None else step_progress
            ),
        )

    async def _emit(self, progress: ProgressValue) -> None:
        event = self._event(progress)
        self._progress = event.progress
        await self._send_event(event)
