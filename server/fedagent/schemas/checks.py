from typing import Literal

from .base import Model, Time


class CheckResult(Model):
    field: str
    resource: str
    status: Literal["running", "passed", "failed", "skipped"]
    message: str


class TaskCheckOut(Model):
    id: str
    status: Literal["queued", "running", "passed", "failed"]
    results: list[CheckResult]
    created_at: Time
    finished_at: Time | None
