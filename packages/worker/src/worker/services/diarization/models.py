from dataclasses import dataclass, field

from pydantic import SecretStr


@dataclass(frozen=True, slots=True)
class DiarizationConfig:
    """Runtime settings selected by the user for one diarization request."""

    enabled: bool = False
    model: str = "pyannote/speaker-diarization-community-1"
    token: str | None = field(default=None, repr=False)
    num_speakers: int | None = None
    min_speakers: int | None = None
    max_speakers: int | None = None
    use_exclusive: bool = True

    def __post_init__(self) -> None:
        if isinstance(self.token, SecretStr):
            object.__setattr__(self, "token", self.token.get_secret_value())

        if not self.model.strip():
            raise ValueError("Diarization model must not be empty")

        speaker_counts = (
            self.num_speakers,
            self.min_speakers,
            self.max_speakers,
        )
        if any(value is not None and value < 1 for value in speaker_counts):
            raise ValueError("Speaker counts must be positive")
        if self.num_speakers is not None and (
            self.min_speakers is not None or self.max_speakers is not None
        ):
            raise ValueError(
                "num_speakers cannot be combined with min_speakers or max_speakers"
            )
        if (
            self.min_speakers is not None
            and self.max_speakers is not None
            and self.min_speakers > self.max_speakers
        ):
            raise ValueError("min_speakers must not exceed max_speakers")


@dataclass(frozen=True, slots=True)
class SpeakerSegment:
    start: float
    end: float
    speaker: str


@dataclass(frozen=True, slots=True)
class DiarizationResult:
    segments: tuple[SpeakerSegment, ...]

    @property
    def speakers(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys(segment.speaker for segment in self.segments))
