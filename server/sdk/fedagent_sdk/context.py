"""每一步的上下文：平台按清单给每一步的能力。

能力只有这里列出的这些；清单没有声明的，代码也拿不到：
- 服务端步骤读不到任何样本；
- 样本默认不含标注字段（清单里给这一步写 labels: true 才有）；
- 只能发送这一步在清单里声明的通道；
- 只有声明了 publishes 的步骤能生成产出；
- 只有被评估的角色、评估用的那一步能把预测交给判分。

读的部分（私有中间结果、收件箱、产出、样本）由 StepIO 提供：平台托管时由平台实现，本地客户端由客户端实现，
所以同一份插件代码在两处的行为一样。写的部分都先收进 UnitResult，工作单元完成时由平台或客户端一起保存。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from .manifest import SERVER, Manifest, StepDef
from .model import Model
from .progress import ProgressUpdate
from .types import Artifact, CapabilityError, Item, Message


@dataclass(frozen=True)
class SiteInfo:
    """执行这一步的一方。role 为 server 时是服务端。"""

    id: str
    role: str
    participant_id: str | None = None
    label: str = ""

    @property
    def is_server(self) -> bool:
        return self.role == SERVER


class StepIO(Protocol):
    def recall(self, key: str, item_id: str | None, round: int) -> Any: ...

    def inbox(self, channel: str, round: int) -> list[Message]: ...

    def artifact(self, before_round: int) -> Artifact | None: ...

    def items(self) -> list[Item]: ...


@dataclass
class OutgoingMessage:
    channel: str
    payload: Any
    item_id: str | None
    to: str | None = None
    """指定接收的站点 id；不写时按通道的接收方（服务端或角色里的每一方）。"""


@dataclass
class UnitResult:
    kept: list[tuple[str, str | None, Any]] = field(default_factory=list)
    sent: list[OutgoingMessage] = field(default_factory=list)
    reports: dict[str, Any] = field(default_factory=dict)
    predictions: list[tuple[str, Any]] = field(default_factory=list)
    published: Any = None
    has_published: bool = False
    logs: list[str] = field(default_factory=list)


class StepContext:
    def __init__(
        self,
        *,
        manifest: Manifest,
        step: StepDef,
        site: SiteInfo,
        round: int,
        rounds: int,
        params: dict[str, Any],
        io: StepIO,
        model: Model | None = None,
        item: Item | None = None,
        log: Callable[[str], None] | None = None,
        progress: Callable[[ProgressUpdate], None] | None = None,
    ) -> None:
        self.manifest = manifest
        self.step = step
        self.site = site
        self.round = round
        self.rounds = rounds
        self.params = params
        self._io = io
        self._model = model
        self._item = item
        self._log = log
        self._progress = progress
        self.result = UnitResult()

    # —— 读 ——

    @property
    def item(self) -> Item:
        if self._item is None:
            raise CapabilityError(f"步骤 {self.step.id} 不是按样本拆的，没有 ctx.item；用 ctx.items()")
        return self._item

    @property
    def item_id(self) -> str | None:
        return self._item.id if self._item is not None else None

    def items(self) -> list[Item]:
        if self.site.is_server:
            raise CapabilityError("服务端步骤读不到样本")
        return self._io.items()

    @property
    def model(self) -> Model:
        if self._model is None:
            raise CapabilityError(f"步骤 {self.step.id} 在清单里没有声明调用模型（model: true）")
        return self._model

    def artifact(self) -> Artifact | None:
        """当前的产出版本（上一轮及之前生成的最新一版）；第 1 轮之前没有产出时是 None。"""
        declared = self.manifest.artifact
        if declared is None:
            raise CapabilityError("清单没有声明产出")
        if not self.site.is_server and self.site.role not in declared.to:
            raise CapabilityError(f"产出没有下发给角色 {self.site.role}")
        return self._io.artifact(self.round)

    def inbox(self, channel: str) -> list[Message]:
        if channel not in self.step.reads:
            raise CapabilityError(f"步骤 {self.step.id} 没有声明读取通道 {channel}")
        return self._io.inbox(channel, self.round)

    def recall(self, key: str, *, item_id: str | None = None, round: int | None = None, default: Any = None) -> Any:
        """读本方之前存下的中间结果。按样本拆的步骤默认读当前样本的。"""
        target = item_id if item_id is not None else self.item_id
        value = self._io.recall(key, target, round or self.round)
        return default if value is None else value

    # —— 写（先收进 result，工作单元完成时一起保存）——

    def keep(self, key: str, value: Any, *, item_id: str | None = None) -> None:
        """存下本方私有的中间结果，只留在本方，后面的步骤用 recall 读。"""
        self.result.kept.append((key, item_id if item_id is not None else self.item_id, value))

    def send(self, channel: str, payload: Any, *, to: str | None = None) -> None:
        if channel not in self.step.sends:
            raise CapabilityError(f"步骤 {self.step.id} 没有声明发送通道 {channel}")
        self.result.sent.append(OutgoingMessage(channel=channel, payload=payload, item_id=self.item_id, to=to))

    def predict(self, prediction: Any) -> None:
        evaluation = self.manifest.evaluation
        if evaluation is None or evaluation.step != self.step.id:
            raise CapabilityError(f"步骤 {self.step.id} 不是评估用的步骤")
        if self.site.is_server or not self.manifest.roles[self.site.role].evaluated:
            raise CapabilityError(f"角色 {self.site.role} 不被评估")
        self.result.predictions.append((self.item.id, prediction))

    def report(self, name: str, value: Any) -> None:
        self.result.reports[name] = value

    def publish(self, content: Any) -> None:
        if not self.step.publishes:
            raise CapabilityError(f"步骤 {self.step.id} 没有声明生成产出")
        self.result.published = content
        self.result.has_published = True

    def log(self, text: str) -> None:
        self.result.logs.append(text)
        if self._log is not None:
            self._log(text)

    def progress(self, activity: str, title: str, status: str, *, parent: str | None = None,
                 item_id: str | None = None, summary: str = "", detail: str = "") -> None:
        """仅发布允许平台用户查看的动作与结果；不传标注、提示词或隐藏推理。"""
        event = ProgressUpdate.model_validate(dict(activity=activity, title=title, status=status, parent=parent,
                                                   item_id=item_id if item_id is not None else self.item_id,
                                                   summary=summary, detail=detail))
        if self._progress is not None:
            self._progress(event)
