from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field, StringConstraints

from .base import Model, Time
from .tasks import OutputItem


class AppIn(Model):
    task_id: str
    built_after_round: int
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class AppPatch(Model):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class AppOut(Model):
    id: str
    task_id: str
    built_after_round: int
    name: str
    published_at: Time
    scenario: str
    task_type: str
    algorithm: str
    plugin_version: str
    items: list[OutputItem]


class ApplyIn(Model):
    input: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)] | dict[str, Any]
    answer: str | None = None
    model: str = "default"


class ApplySide(Model):
    output: str
    correct: bool | None
    tokens: int
    details: dict[str, Any] = Field(default={})


class ApplyOut(Model):
    without: ApplySide
    with_: ApplySide = Field(alias="with")
