"""插件和平台之间传递的数据。"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Item:
    """一条样本。交给算法步骤时默认去掉了标注字段（见清单里步骤的 labels）。"""

    id: str
    fields: Mapping[str, Any]

    def __getitem__(self, key: str) -> Any:
        return self.fields[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.fields.get(key, default)

    def __iter__(self) -> Iterator[str]:
        return iter(self.fields)


@dataclass(frozen=True)
class Message:
    """跨站点的一条消息。发送方是站点 id；item_id 是发送它的工作单元对应的样本（按站点拆的步骤为 None）。"""

    id: str
    channel: str
    round: int
    step: str
    sender: str
    sender_role: str
    payload: Any
    item_id: str | None = None


@dataclass(frozen=True)
class Artifact:
    """一版产出。round 是生成它的轮次。"""

    version: int
    round: int
    kind: str
    content: Any


@dataclass(frozen=True)
class OutputEntry:
    """界面上列出的一条产出内容（FoT 是经验库里的一条经验）。"""

    key: str
    text: str
    category: str | None = None


@dataclass(frozen=True)
class SiteSpec:
    """预估和校验用：任务里的一方。"""

    id: str
    role: str
    items: int
    labeled: int


@dataclass(frozen=True)
class TaskSpec:
    """预估和插件自己的校验用：任务配置的摘要。"""

    scenario: str
    task_type: str
    rounds: int
    params: Mapping[str, Any]
    sites: list[SiteSpec]
    workers: int = 8


@dataclass
class Estimate:
    participant_calls: int = 0
    server_calls: int = 0
    """服务端调用模型的步骤每轮各一次；结果不合法时会重试，所以是下限。"""
    participant_tokens: int = 0
    server_tokens: int = 0
    seconds: int = 0
    exchanged: int = 0
    """预计交换的消息条数（每轮）。"""


@dataclass(frozen=True)
class Issue:
    field: str
    message: str


@dataclass
class ApplyRequest:
    """使用产出（应用试用、API）：一条输入。answer 有值时自动判分。"""

    input: str
    answer: str | None = None
    options: dict[str, Any] = field(default_factory=dict)


@dataclass
class ApplyResult:
    output: str
    usage: dict[str, Any] = field(default_factory=dict)
    details: dict[str, Any] = field(default_factory=dict)


class StepFailed(Exception):
    """步骤主动报告失败。pause=True 时不再重试，直接暂停任务并写明原因。"""

    def __init__(self, message: str, *, pause: bool = False) -> None:
        super().__init__(message)
        self.pause = pause


class CapabilityError(Exception):
    """步骤用了清单没有声明的能力（例如发送未声明的通道、服务端读样本）。"""
