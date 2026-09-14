from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, JsonValue

JsonObject: TypeAlias = dict[str, JsonValue]


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class ExecuteTaskRequest(ApiModel):
    type: str = Field(min_length=1)
    task_id: int = Field(alias="taskId", gt=0)
    callback_url: HttpUrl = Field(alias="callbackUrl")
    input: JsonObject
    config: JsonObject


class ExecuteTaskResponse(ApiModel):
    accepted: Literal[True] = True


class StorageReference(ApiModel):
    bucket: str = Field(min_length=1)
    object_key: str = Field(alias="objectKey", min_length=1)


class WorkerEventStarted(ApiModel):
    type: Literal["task.started"] = "task.started"
    task_id: int = Field(alias="taskId", gt=0)


ProgressValue = Annotated[float, Field(ge=0, le=100)]


class WorkerEventProgress(ApiModel):
    type: Literal["task.progress"] = "task.progress"
    task_id: int = Field(alias="taskId", gt=0)
    progress: ProgressValue


class WorkerEventCompleted(ApiModel):
    type: Literal["task.completed"] = "task.completed"
    task_id: int = Field(alias="taskId", gt=0)
    output: JsonObject


class WorkerEventFailed(ApiModel):
    type: Literal["task.failed"] = "task.failed"
    task_id: int = Field(alias="taskId", gt=0)
    error: JsonObject


WorkerEvent: TypeAlias = (
    WorkerEventStarted
    | WorkerEventProgress
    | WorkerEventCompleted
    | WorkerEventFailed
)
