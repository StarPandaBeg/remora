from pydantic import BaseModel, ConfigDict, Field


class _ChunkingConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    target_duration: float = Field(alias="targetDuration")
    min_duration: float = Field(alias="minDuration")
    max_duration: float = Field(alias="maxDuration")
    min_good_silence: float = Field(alias="minGoodSilence")
    padding_before: float = Field(alias="paddingBefore")
    padding_after: float = Field(alias="paddingAfter")


class DynamicConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    prefer_source: bool = Field(alias="preferSource")
    chunking: _ChunkingConfig
