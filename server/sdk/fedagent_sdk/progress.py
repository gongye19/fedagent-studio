"""可选的公开执行事件；不属于算法结果或联邦交换，不允许携带任意私有对象。"""
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ProgressUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    activity: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=120)
    status: Literal["running", "completed", "failed"]
    parent: str | None = Field(default=None, max_length=120)
    item_id: str | None = Field(default=None, max_length=200)
    summary: str = Field(default="", max_length=500)
    detail: str = Field(default="", max_length=6000)


class ProgressEvent(ProgressUpdate):
    seq: int = Field(ge=1)
    at: datetime = Field(default_factory=lambda: datetime.now(UTC))
