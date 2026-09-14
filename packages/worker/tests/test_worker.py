import asyncio
import json
import logging
import threading
from collections.abc import Callable
from pathlib import Path
from typing import cast

import httpx
import pytest
from fastapi.testclient import TestClient
from minio import Minio

from worker.callbacks import CallbackSender
from worker.config import Settings, load_settings
from worker.main import create_app
from worker.models import (
    ExecuteTaskRequest,
    StorageReference,
    WorkerEventCompleted,
    WorkerEventProgress,
)
from worker.storage import MinioStorage

SECRET = "test-worker-secret"
CALLBACK_URL = "https://core.example/tasks/events"


class FakeMinio:
    def __init__(self, download_error: Exception | None = None) -> None:
        self.calls: list[tuple[object, ...]] = []
        self.thread_ids: list[int] = []
        self.downloaded_path: Path | None = None
        self.download_error = download_error

    def fget_object(
        self,
        bucket: str,
        object_key: str,
        file_path: str,
    ) -> object:
        self.calls.append(("download", bucket, object_key, file_path))
        self.thread_ids.append(threading.get_ident())
        self.downloaded_path = Path(file_path)
        self.downloaded_path.write_bytes(b"object contents")
        if self.download_error is not None:
            raise self.download_error
        return object()

    def fput_object(
        self,
        bucket: str,
        object_key: str,
        file_path: str,
        content_type: str,
    ) -> object:
        self.calls.append(
            ("upload", bucket, object_key, file_path, content_type)
        )
        self.thread_ids.append(threading.get_ident())
        return object()

    def remove_object(self, bucket: str, object_key: str) -> None:
        self.calls.append(("delete", bucket, object_key))
        self.thread_ids.append(threading.get_ident())


def make_storage(fake: FakeMinio) -> MinioStorage:
    return MinioStorage(make_settings(), cast(Minio, fake))


def make_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "worker_secret": SECRET,
        "minio_endpoint": "minio.internal",
        "minio_port": 9000,
        "minio_use_ssl": False,
        "minio_access_key": "test-access-key",
        "minio_secret_key": "test-secret-key",
        "minio_bucket": "remora",
        "minio_region": "us-east-1",
        "max_concurrent_tasks": 2,
        "http_timeout": 1,
        "final_event_retry_count": 3,
        "final_event_retry_base_delay": 0,
    }
    values.update(overrides)
    return Settings.model_validate(values)


def payload(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "pipeline": "video_summary",
        "type": "test",
        "taskId": 123,
        "callbackUrl": CALLBACK_URL,
        "input": {},
        "config": {},
    }
    values.update(overrides)
    return values


def run_task_and_collect(
    task_payload: dict[str, object],
    callback: Callable[[httpx.Request], httpx.Response] | None = None,
    storage: MinioStorage | None = None,
) -> tuple[httpx.Response, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if callback is not None:
            return callback(request)
        return httpx.Response(204)

    app = create_app(
        settings=make_settings(),
        transport=httpx.MockTransport(record),
        storage=storage,
    )
    with TestClient(app) as client:
        response = client.post("/tasks/execute", json=task_payload)

    return response, requests


def event_bodies(requests: list[httpx.Request]) -> list[dict[str, object]]:
    return [json.loads(request.content) for request in requests]


def test_execute_payload_and_callback_url_validation() -> None:
    app = create_app(
        settings=make_settings(),
        transport=httpx.MockTransport(lambda _request: httpx.Response(204)),
    )

    with TestClient(app) as client:
        without_pipeline = payload()
        without_pipeline.pop("pipeline")
        missing_field = client.post(
            "/tasks/execute",
            json=without_pipeline,
        )
        invalid_url = client.post(
            "/tasks/execute",
            json=payload(callbackUrl="ftp://core.example/callback"),
        )
        empty_pipeline = client.post(
            "/tasks/execute",
            json=payload(pipeline=""),
        )
        invalid_objects = client.post(
            "/tasks/execute",
            json=payload(input=[], config="not-an-object"),
        )

    assert missing_field.status_code == 422
    assert invalid_url.status_code == 422
    assert empty_pipeline.status_code == 422
    assert invalid_objects.status_code == 422


def test_missing_or_empty_worker_secret_is_configuration_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("MINIO_ACCESS_KEY", "access")
    monkeypatch.setenv("MINIO_SECRET_KEY", "secret")
    monkeypatch.delenv("WORKER_SECRET", raising=False)
    monkeypatch.chdir(tmp_path)

    with pytest.raises(RuntimeError, match="WORKER_SECRET"):
        load_settings()

    monkeypatch.setenv("WORKER_SECRET", "   ")
    with pytest.raises(RuntimeError, match="WORKER_SECRET"):
        load_settings()


def test_minio_settings_use_existing_environment_names(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    environment = {
        "WORKER_SECRET": SECRET,
        "MINIO_ENDPOINT": "storage.example",
        "MINIO_PORT": "9443",
        "MINIO_USE_SSL": "true",
        "MINIO_ACCESS_KEY": "shared-access",
        "MINIO_SECRET_KEY": "shared-secret",
        "MINIO_BUCKET": "shared-bucket",
        "MINIO_REGION": "eu-west-1",
    }
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    monkeypatch.chdir(tmp_path)

    settings = load_settings()

    assert settings.minio_endpoint == "storage.example"
    assert settings.minio_port == 9443
    assert settings.minio_use_ssl is True
    assert settings.minio_access_key.get_secret_value() == "shared-access"
    assert settings.minio_secret_key.get_secret_value() == "shared-secret"
    assert settings.minio_bucket == "shared-bucket"
    assert settings.minio_region == "eu-west-1"


def test_storage_download_upload_delete_and_reference(tmp_path: Path) -> None:
    fake = FakeMinio()
    storage = make_storage(fake)
    source = StorageReference(
        bucket="source-bucket",
        objectKey="entries/files/abc/original.mp4",
    )
    destination = tmp_path / "nested" / "source.mp4"
    event_loop_thread = threading.get_ident()

    async def exercise_storage() -> StorageReference:
        downloaded = await storage.download(source, destination)
        assert downloaded == destination
        uploaded = await storage.upload(
            destination,
            "entries/files/abc/processed.mp4",
            "video/mp4",
        )
        await storage.delete(uploaded)
        return uploaded

    uploaded = asyncio.run(exercise_storage())

    assert destination.read_bytes() == b"object contents"
    assert uploaded.model_dump(by_alias=True) == {
        "bucket": "remora",
        "objectKey": "entries/files/abc/processed.mp4",
    }
    assert fake.calls == [
        (
            "download",
            "source-bucket",
            "entries/files/abc/original.mp4",
            str(destination),
        ),
        (
            "upload",
            "remora",
            "entries/files/abc/processed.mp4",
            str(destination),
            "video/mp4",
        ),
        ("delete", "remora", "entries/files/abc/processed.mp4"),
    ]
    assert all(thread_id != event_loop_thread for thread_id in fake.thread_ids)


def test_storage_handler_uploads_and_cleans_temporary_file() -> None:
    fake = FakeMinio()
    storage = make_storage(fake)
    response, requests = run_task_and_collect(
        payload(
            type="test.storage",
            input={
                "source": {
                    "bucket": "remora",
                    "objectKey": "entries/files/source/original.mp4",
                },
                "destinationObjectKey": "entries/files/source/processed.mp4",
                "contentType": "video/mp4",
            },
        ),
        storage=storage,
    )

    assert response.status_code == 202
    assert event_bodies(requests)[-1] == {
        "type": "task.completed",
        "taskId": 123,
        "output": {
            "bucket": "remora",
            "objectKey": "entries/files/source/processed.mp4",
        },
    }
    assert fake.downloaded_path is not None
    assert not fake.downloaded_path.parent.exists()


def test_minio_failure_sends_safe_failure_cleans_up_and_worker_continues() -> None:
    fake = FakeMinio(RuntimeError("MinIO unavailable"))
    storage = make_storage(fake)
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(204)

    app = create_app(
        settings=make_settings(),
        transport=httpx.MockTransport(record),
        storage=storage,
    )
    storage_input = {
        "source": {
            "bucket": "remora",
            "objectKey": "entries/files/source/original.mp4",
        },
        "destinationObjectKey": "entries/files/source/processed.mp4",
    }
    with TestClient(app) as client:
        failed = client.post(
            "/tasks/execute",
            json=payload(type="test.storage", taskId=41, input=storage_input),
        )
        healthy = client.post(
            "/tasks/execute",
            json=payload(taskId=42),
        )

    events = event_bodies(requests)
    failed_events = [event for event in events if event["taskId"] == 41]
    healthy_events = [event for event in events if event["taskId"] == 42]
    serialized_events = json.dumps(events)

    assert failed.status_code == 202
    assert healthy.status_code == 202
    assert failed_events[-1] == {
        "type": "task.failed",
        "taskId": 41,
        "error": {
            "code": "HANDLER_ERROR",
            "message": "Task execution failed",
        },
    }
    assert healthy_events[-1]["type"] == "task.completed"
    assert "test-access-key" not in serialized_events
    assert "test-secret-key" not in serialized_events
    assert fake.downloaded_path is not None
    assert not fake.downloaded_path.parent.exists()


def test_health() -> None:
    app = create_app(
        settings=make_settings(),
        transport=httpx.MockTransport(lambda _request: httpx.Response(204)),
    )

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_execute_returns_202_and_successful_handler_sends_lifecycle(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    response, requests = run_task_and_collect(
        payload(pipeline="pipeline-not-used-for-dispatch", taskId=456)
    )
    events = event_bodies(requests)

    assert response.status_code == 202
    assert response.json() == {"accepted": True}
    assert [event["type"] for event in events] == [
        "task.started",
        "task.progress",
        "task.progress",
        "task.completed",
    ]
    assert [event["progress"] for event in events[1:3]] == [25.0, 75.0]
    assert events[-1]["output"] == {"message": "Test task completed"}
    assert all(event["taskId"] == 456 for event in events)
    assert all("pipeline" not in event for event in events)
    assert all(str(request.url) == CALLBACK_URL for request in requests)
    assert all(request.headers["x-worker-secret"] == SECRET for request in requests)
    assert all("worker-secret" not in request.content.decode() for request in requests)
    assert any(
        "pipeline=pipeline-not-used-for-dispatch type=test taskId=456"
        in record.getMessage()
        for record in caplog.records
    )


def test_failing_handler_sends_safe_failure_and_worker_keeps_running() -> None:
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(204)

    app = create_app(
        settings=make_settings(),
        transport=httpx.MockTransport(record),
    )
    with TestClient(app) as client:
        first = client.post(
            "/tasks/execute",
            json=payload(taskId=1, input={"fail": True}),
        )
        second = client.post(
            "/tasks/execute",
            json=payload(taskId=2),
        )

    events = event_bodies(requests)
    first_events = [event for event in events if event["taskId"] == 1]
    second_events = [event for event in events if event["taskId"] == 2]

    assert first.status_code == 202
    assert second.status_code == 202
    assert first_events[-1] == {
        "type": "task.failed",
        "taskId": 1,
        "error": {
            "code": "HANDLER_ERROR",
            "message": "Task execution failed",
        },
    }
    assert "task.completed" not in [event["type"] for event in first_events]
    assert second_events[-1]["type"] == "task.completed"


def test_unknown_task_type_sends_failure_without_starting_handler() -> None:
    response, requests = run_task_and_collect(
        payload(type="does-not-exist", taskId=99)
    )

    assert response.status_code == 202
    assert event_bodies(requests) == [
        {
            "type": "task.failed",
            "taskId": 99,
            "error": {
                "code": "UNKNOWN_TASK_TYPE",
                "message": "Unknown task type: does-not-exist",
            },
        }
    ]


def test_progress_callback_failure_does_not_break_handler() -> None:
    def reject_progress(request: httpx.Request) -> httpx.Response:
        event = json.loads(request.content)
        return httpx.Response(503 if event["type"] == "task.progress" else 204)

    _, requests = run_task_and_collect(payload(), reject_progress)
    event_types = [event["type"] for event in event_bodies(requests)]

    assert event_types == [
        "task.started",
        "task.progress",
        "task.progress",
        "task.completed",
    ]


def test_final_callback_is_retried_and_no_failed_event_is_added() -> None:
    completed_attempts = 0

    def fail_then_succeed(request: httpx.Request) -> httpx.Response:
        nonlocal completed_attempts
        event = json.loads(request.content)
        if event["type"] == "task.completed":
            completed_attempts += 1
            return httpx.Response(204 if completed_attempts == 3 else 503)
        return httpx.Response(204)

    _, requests = run_task_and_collect(payload(), fail_then_succeed)
    final_events = [
        event
        for event in event_bodies(requests)
        if event["type"] in {"task.completed", "task.failed"}
    ]

    assert completed_attempts == 3
    assert len(final_events) == 3
    assert {event["type"] for event in final_events} == {"task.completed"}


def test_progress_range_is_validated() -> None:
    with pytest.raises(ValueError):
        WorkerEventProgress(taskId=1, progress=101)


def test_callback_sender_never_places_secret_in_body() -> None:
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(204)

    async def send() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(record),
        ) as client:
            sender = CallbackSender(client, make_settings())
            await sender.send_event(
                CALLBACK_URL,
                WorkerEventCompleted(taskId=7, output={"result": "ok"}),
            )

    asyncio.run(send())

    assert requests[0].headers["x-worker-secret"] == SECRET
    assert SECRET.encode() not in requests[0].content


def test_request_model_accepts_json_objects() -> None:
    command = ExecuteTaskRequest.model_validate(
        payload(input={"nested": [1, True, None]}, config={"quality": "high"})
    )

    assert command.task_id == 123
    assert command.pipeline == "video_summary"
    assert command.input["nested"] == [1, True, None]
