import asyncio
from pathlib import Path

import pytest
from pydantic import ValidationError

from worker.handlers.voice_recognition import load_manifest


def test_load_manifest(tmp_path: Path) -> None:
    path = tmp_path / "manifest.json"
    path.write_text(
        '{"start_offset": 1.25, "end_offset": 0, '
        '"vad_object_key": "entries/files/id/vad.json", '
        '"chunks": [{"start": 1.25, "end": 4.5, "silence_after": 0.5}]}',
        encoding="utf-8",
    )

    result = asyncio.run(load_manifest(path))

    assert result.start_offset == 1.25
    assert result.end_offset == 0
    assert result.vad_object_key == "entries/files/id/vad.json"
    assert result.chunks[0].start == 1.25
    assert result.chunks[0].end == 4.5
    assert result.chunks[0].silence_after == 0.5


def test_load_manifest_rejects_non_object(tmp_path: Path) -> None:
    path = tmp_path / "manifest.json"
    path.write_text("[]", encoding="utf-8")

    with pytest.raises(ValidationError):
        asyncio.run(load_manifest(path))
