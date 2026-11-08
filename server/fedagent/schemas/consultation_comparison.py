from typing import Literal

from pydantic import Field

from .base import Model
from .experience import Status

Arm = Literal["baseline", "experience"]
Action = Literal["ask", "exam", "test", "diagnosis"]
ArmStatus = Literal["waiting", "running", "diagnosed", "limit", "failed", "canceled"]


class ComparisonCase(Model):
    id: str
    title: str
    opening: str


class ComparisonIn(Model):
    case_id: str = Field(min_length=1, max_length=64)
    package_id: str = Field(min_length=1, max_length=64)
    model: str = Field(min_length=1, max_length=160)


class ComparisonStep(Model):
    action: Action
    label: str
    text: str
    result: str | None = None


class ComparisonArm(Model):
    arm: Arm
    status: ArmStatus
    steps: list[ComparisonStep]
    diagnosis: str | None = None
    matched: bool | None = None


class ComparisonOut(Model):
    id: str
    case: ComparisonCase
    package_name: str
    model: str
    status: Status
    max_steps: int
    arms: list[ComparisonArm]
    reference: str | None = None
    error: str | None = None
