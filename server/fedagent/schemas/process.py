from fedagent_sdk import ProgressUpdate
from pydantic import Field

from .base import Model, Time


class ProcessEventOut(Model):
    id: int
    origin: str
    site: str
    round: int
    step: str
    unit: str
    at: Time
    event: ProgressUpdate


class ProcessPageOut(Model):
    events: list[ProcessEventOut] = Field(default_factory=list)
    after: int = 0
    has_more: bool = False
    states: dict[str, str] = Field(default_factory=dict)
