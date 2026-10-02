"""算法插件的基类。

插件继承 Algorithm，在类上写 manifest（读自插件包里的 manifest.yaml），每一步写一个方法并用 @step 对应到清单里的步骤。
平台只按清单编排，执行到某一步时调用 run_step；产出怎么用（应用试用、API、导出）由 apply、export 决定。
"""

from __future__ import annotations

import hashlib
import inspect
import json
import math
from collections.abc import Callable
from pathlib import Path
from typing import Any, ClassVar

from .context import StepContext
from .manifest import SERVER, Manifest
from .model import Model
from .types import ApplyRequest, ApplyResult, Artifact, Estimate, Issue, OutputEntry, TaskSpec

StepFunction = Callable[[Any, StepContext], None]


def step(step_id: str) -> Callable[[StepFunction], StepFunction]:
    """把方法标成清单里的某一步。"""

    def mark(function: StepFunction) -> StepFunction:
        function.__fedagent_step__ = step_id  # type: ignore[attr-defined]
        return function

    return mark


class Algorithm:
    manifest: ClassVar[Manifest]

    def __init__(self) -> None:
        self._steps: dict[str, Callable[[StepContext], None]] = {}
        for _, member in inspect.getmembers(self, predicate=inspect.ismethod):
            step_id = getattr(member, "__fedagent_step__", None)
            if step_id is not None:
                self._steps[step_id] = member
        missing = [item.id for item in self.manifest.steps if item.id not in self._steps]
        if missing:
            raise TypeError(f"{type(self).__name__} 缺少步骤的实现：{', '.join(missing)}")
        extra = [step_id for step_id in self._steps if self.manifest.step(step_id) is None]
        if extra:
            raise TypeError(f"{type(self).__name__} 实现了清单里没有的步骤：{', '.join(extra)}")

    # —— 平台调用的接口 ——

    @property
    def id(self) -> str:
        return self.manifest.id

    @property
    def version(self) -> str:
        return self.manifest.version

    def code_hash(self) -> str:
        """插件包里所有源文件和清单的哈希：任务记下它，续跑时版本不一致就拒绝。"""
        root = Path(inspect.getfile(type(self))).parent
        digest = hashlib.sha256()
        for path in sorted(root.rglob("*")):
            if path.is_file() and path.suffix in {".py", ".yaml", ".yml", ".txt", ".json", ".md"} and "__pycache__" not in path.parts:
                digest.update(path.relative_to(root).as_posix().encode())
                digest.update(path.read_bytes())
        return digest.hexdigest()

    def prompt_hashes(self) -> dict[str, str]:
        """插件用到的提示词的哈希，记进任务的审计信息。没有提示词的算法返回空。"""
        return {}

    def validate(self, spec: TaskSpec) -> list[Issue]:
        return []

    def plan(self, round: int, rounds: int) -> list[str]:
        """这一轮执行哪些步骤，默认按清单顺序。"""
        return [item.id for item in self.manifest.steps]

    def run_step(self, ctx: StepContext) -> None:
        self._steps[ctx.step.id](ctx)

    def estimate(self, spec: TaskSpec) -> Estimate:
        """按清单里每一步的预估算调用量：

        - 参与方按样本拆、调用模型的步骤：每条样本调用一次；
        - 服务端调用模型的步骤：每轮一次，读入各方发给服务端的全部内容；
        - 耗时：参与方步骤按全部样本分批排队（并发数是任务的并发设置），服务端步骤各自计时。
        """
        manifest = self.manifest
        participant_items = sum(site.items for site in spec.sites)
        exchanged = sum(participant_items * self.exchange_per_item(name, spec) for name, channel in manifest.channels.items() if channel.from_ != SERVER)
        upload_tokens = sum(
            participant_items * self.exchange_per_item(name, spec) * (channel.tokens or 0)
            for name, channel in manifest.channels.items()
            if channel.to == SERVER
        )
        result = Estimate(exchanged=round(exchanged))
        batches = math.ceil(participant_items / max(1, spec.workers)) if participant_items else 0
        seconds = 0.0
        for item in manifest.steps:
            if item.at == SERVER:
                seconds += item.estimate.seconds
                if item.model:
                    result.server_calls += spec.rounds
                    result.server_tokens += round((upload_tokens + item.estimate.tokens) * spec.rounds)
            else:
                units = participant_items if item.per == "item" else len(spec.sites)
                seconds += (batches if item.per == "item" else 1) * item.estimate.seconds
                if item.model:
                    result.participant_calls += units * spec.rounds
                    result.participant_tokens += units * item.estimate.tokens * spec.rounds
        result.seconds = round(seconds * spec.rounds)
        return result

    def exchange_per_item(self, channel: str, spec: TaskSpec) -> float:
        """预估用：每条样本在这个通道上平均发几条。默认读清单，参数会影响交换量的算法可以覆盖。"""
        return self.manifest.channels[channel].per_item or 0

    def apply(self, artifact: Artifact | None, request: ApplyRequest, model: Model) -> ApplyResult:
        raise NotImplementedError(f"{self.id} 没有实现产出的使用方式")

    def export(self, artifact: Artifact, fmt: str = "json") -> tuple[str, str, bytes]:
        """导出产出：返回（文件名、媒体类型、内容）。默认导出 JSON。"""
        body = json.dumps(artifact.content, ensure_ascii=False, indent=2).encode()
        return f"{self.id}_v{artifact.version}.json", "application/json", body

    def describe(self, artifact: Artifact) -> list[OutputEntry]:
        """界面上列出的产出内容。默认把字典的每一项当作一条。"""
        content = artifact.content
        if isinstance(content, dict):
            return [OutputEntry(key=str(key), text=str(value)) for key, value in content.items()]
        if isinstance(content, list):
            return [OutputEntry(key=str(index + 1), text=str(value)) for index, value in enumerate(content)]
        return [OutputEntry(key="1", text=str(content))]

    def describe_message(self, channel: str, payload: Any) -> OutputEntry:
        """界面"通信记录"里一条消息的显示。默认：字典有 name / description 就用它们，否则整条转成文本。"""
        if isinstance(payload, dict):
            key = payload.get("name") or payload.get("key") or ""
            text = payload.get("description") or payload.get("text")
            if text is not None:
                return OutputEntry(key=str(key), text=str(text))
            return OutputEntry(key=str(key), text=json.dumps(payload, ensure_ascii=False))
        return OutputEntry(key="", text=str(payload))

    def fake_reply(self, step_id: str | None, prompt: str, seed: str) -> str | None:
        """假模型的回答：开发、测试、演示时不调用真实模型。

        插件可以为自己的步骤返回格式正确的内容（例如合法的 JSON），这样整个流程能在假模型上跑通；
        返回 None 时平台用通用的假回答。
        """
        return None
