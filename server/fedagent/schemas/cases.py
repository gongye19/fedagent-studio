from typing import Literal

from pydantic import Field

from .base import Model
from .resources import PreviewFieldOut


class CaseOut(Model):
    key: str
    round: int
    site: str
    item_id: str
    outcome: Literal["passed", "incorrect", "unlabeled", "error"]
    step: str
    input: str | None = None
    fields: list[PreviewFieldOut] = Field(default=[])
    prediction: str | None = None
    reference: str | None = None
    error: str | None = None


class CasePageOut(Model):
    items: list[CaseOut]
    total: int
    counts: dict[str, int]
    has_more: bool
