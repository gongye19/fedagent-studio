"""模型：每一步通过 ctx.model 调用，平台托管时走模型网关，本地客户端用参与方自己的模型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class ChatResult:
    text: str
    model: str
    usage: dict[str, int] = field(default_factory=dict)
    finish_reason: str | None = None
    cached: bool = False
    """续跑时从调用账本里取出的结果。"""


class ModelError(Exception):
    """模型调用失败（重试之后仍失败，或者请求本身有问题）。"""


class Model(Protocol):
    name: str

    def chat(
        self,
        prompt: str | list[dict[str, Any]],
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
        **extra: Any,
    ) -> ChatResult: ...


@dataclass
class MeteredModel:
    """统计一个应用调用内的全部模型用量，包括独立判分；账本仍由底层网关记录。"""
    model: Model
    usage: dict[str, int] = field(default_factory=dict)

    name: str = field(init=False)

    def __post_init__(self):
        self.name = self.model.name

    def chat(self, prompt, **kwargs) -> ChatResult:
        result = self.model.chat(prompt, **kwargs)
        for key, value in result.usage.items():
            if isinstance(value, int):
                self.usage[key] = self.usage.get(key, 0) + value
        return result
