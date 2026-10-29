"""模型：每一步通过 ctx.model 调用，平台托管时走模型网关，本地客户端用参与方自己的模型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


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


class ModelUnavailable(ModelError):
    """没有获得可用回复的暂时性错误；此前成功调用仍可重放。"""


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


@runtime_checkable
class ForkableModel(Model, Protocol):
    """可选能力：为独立并行分支提供稳定账本位置，不共享调用序号。"""
    def fork(self, scope: str) -> Model: ...


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
