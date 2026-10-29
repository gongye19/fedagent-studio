"""算法清单：算法的静态声明。

注册表、配置校验、预估、进度页和算法页都只读清单，不运行算法代码。清单写在插件包里的 manifest.yaml，
由 load_manifest 读入并校验：步骤只能在声明过的角色或服务端执行，只能读写声明过的交换通道，
生成产出的步骤必须声明了产出，评估用的步骤必须在被评估的角色上。
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

SERVER = "server"
"""服务端在清单里的写法：步骤的 at、通道的 from / to 都可以写 server。"""

ScenarioId = Literal["horizontal", "vertical", "transfer"]
ResultKind = Literal["metric", "uploads", "received", "groups", "output"]
"""一步完成后进度页记什么：指标、上传条数、收到条数、类别数、产出条数。"""


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class RoleDef(_Model):
    label: str = "参与方"
    min: int = 1
    max: int | None = None
    evaluated: bool = False
    """是否在这个角色上评估（判分在这一方执行）。"""


class RoundsDef(_Model):
    min: int = 1
    max: int = 10
    default: int = 3
    labels: list[str] = []
    """固定对照组的展示名称；空数组表示通常的迭代轮次。"""


class ChannelDef(_Model):
    label: str
    from_: str = Field(alias="from")
    to: str
    kind: Literal["text", "json", "bytes"] = "json"
    per_item: float | None = None
    """预估用：每条样本平均发几条。"""
    tokens: int | None = None
    """预估用：每条大约多少 token。"""


class ArtifactDef(_Model):
    kind: str
    """产出的类型，例如 text-library（文本库）、prompt、retrieval-index、model-weights。"""
    name: str
    unit: str
    to: list[str]
    """下发给哪些角色。"""


class EstimateDef(_Model):
    seconds: float = 0
    """参与方按样本拆的步骤：一批并发调用的耗时；其他步骤：这一步的耗时。"""
    tokens: int = 0
    """每次模型调用输出的 token。"""


class StepDef(_Model):
    id: str
    label: str
    at: str
    """在哪个角色上执行，或者 server。"""
    per: Literal["item", "site"] = "site"
    """item：每条样本一个工作单元；site：每个站点一个工作单元。"""
    model: bool = False
    reads: list[str] = []
    sends: list[str] = []
    publishes: bool = False
    private_state: bool = False
    """外部服务在本站保存 kept，响应不返回私有中间状态。"""
    labels: bool = False
    """为 true 时平台才把标注字段交给这一步（记入审计）。"""
    result: ResultKind | None = None
    estimate: EstimateDef = EstimateDef()
    retries: int = 2
    """工作单元失败后最多重试几次，仍失败就暂停任务。"""


class EvaluationDef(_Model):
    step: str
    baseline: Literal["round-1", "separate"] = "round-1"
    """round-1：第 1 轮不带产出，就是本地基线；separate：平台在第 1 轮前单独跑一次不带产出的评估。"""


class ParamOption(_Model):
    value: str | int | float | None
    label: str


class ParamDef(_Model):
    key: str
    label: str
    help: str = ""
    kind: Literal["select", "select-number", "number"]
    options: list[ParamOption] = []
    min: float | None = None
    max: float | None = None
    unit: str | None = None
    default: str | int | float | None

    def check(self, value: object) -> str | None:
        """取值不合法时返回原因。"""
        if self.kind in ("select", "select-number"):
            if all(option.value != value for option in self.options):
                return f"{self.label}：不是可选的取值"
            return None
        if not isinstance(value, int | float) or isinstance(value, bool):
            return f"{self.label}：应是数字"
        if self.min is not None and value < self.min:
            return f"{self.label}：不能小于 {self.min:g}"
        if self.max is not None and value > self.max:
            return f"{self.label}：不能大于 {self.max:g}"
        return None


class SourceDef(_Model):
    paper: str | None = None
    paper_url: str | None = None
    code: str | None = None
    code_url: str | None = None
    commit: str | None = None


class Manifest(_Model):
    id: str
    version: str
    name: str
    full_name: str = ""
    summary: str = ""
    scenario: ScenarioId
    accepts: list[str]
    agent_supported: bool = True
    """是否开放通过外部 Agent API 创建任务；既有运行与 SDK 执行不受影响。"""
    agent_required: bool = False
    """本方流程必须由接入方 Agent 执行；不影响 SDK 在用户侧执行插件。"""
    roles: dict[str, RoleDef]
    rounds: RoundsDef = RoundsDef()
    channels: dict[str, ChannelDef] = {}
    artifact: ArtifactDef | None = None
    evaluation: EvaluationDef | None = None
    steps: list[StepDef]
    params: list[ParamDef] = []
    source: SourceDef = SourceDef()

    @model_validator(mode="after")
    def _check(self) -> Manifest:
        if self.agent_required and not self.agent_supported:
            raise ValueError("要求 Agent 的算法必须支持 Agent 执行")
        places = {*self.roles, SERVER}
        if SERVER in self.roles:
            raise ValueError("角色不能叫 server")
        if not self.roles:
            raise ValueError("至少要有一种角色")
        if not self.steps:
            raise ValueError("至少要有一个步骤")
        ids = [step.id for step in self.steps]
        if len(ids) != len(set(ids)):
            raise ValueError("步骤 id 重复")
        for name, channel in self.channels.items():
            if channel.from_ not in places or channel.to not in places:
                raise ValueError(f"通道 {name} 的 from / to 不是已声明的角色或 server")
            if channel.from_ == channel.to == SERVER:
                raise ValueError(f"通道 {name} 不能从服务端发给服务端")
        for step in self.steps:
            if step.at not in places:
                raise ValueError(f"步骤 {step.id} 的 at 不是已声明的角色或 server")
            if step.at == SERVER and step.per == "item":
                raise ValueError(f"步骤 {step.id}：服务端没有样本，不能按样本拆")
            for channel in step.sends:
                if channel not in self.channels:
                    raise ValueError(f"步骤 {step.id} 发送的通道 {channel} 没有声明")
                if self.channels[channel].from_ != step.at:
                    raise ValueError(f"步骤 {step.id} 在 {step.at} 执行，不能发送 {channel}（发送方是 {self.channels[channel].from_}）")
            for channel in step.reads:
                if channel not in self.channels:
                    raise ValueError(f"步骤 {step.id} 读取的通道 {channel} 没有声明")
                if self.channels[channel].to != step.at:
                    raise ValueError(f"步骤 {step.id} 在 {step.at} 执行，读不到 {channel}（接收方是 {self.channels[channel].to}）")
            if step.publishes and self.artifact is None:
                raise ValueError(f"步骤 {step.id} 生成产出，但清单没有声明产出")
            if step.labels and step.at == SERVER:
                raise ValueError(f"步骤 {step.id}：服务端不能读标注")
        if self.artifact is not None:
            unknown = [role for role in self.artifact.to if role not in self.roles]
            if unknown:
                raise ValueError(f"产出下发给未声明的角色：{', '.join(unknown)}")
        if self.evaluation is not None:
            step = self.step(self.evaluation.step)
            if step is None:
                raise ValueError(f"评估用的步骤 {self.evaluation.step} 不存在")
            if step.at == SERVER or not self.roles[step.at].evaluated:
                raise ValueError(f"评估用的步骤 {step.id} 必须在被评估的角色上执行")
            if step.per != "item":
                raise ValueError(f"评估用的步骤 {step.id} 必须按样本拆")
        keys = [param.key for param in self.params]
        if len(keys) != len(set(keys)):
            raise ValueError("参数键重复")
        for param in self.params:
            problem = param.check(param.default)
            if problem:
                raise ValueError(f"参数默认值不合法：{problem}")
        if not self.rounds.min <= self.rounds.default <= self.rounds.max:
            raise ValueError("轮次默认值不在范围内")
        if self.rounds.labels and (not self.rounds.min == self.rounds.max == len(self.rounds.labels)
                                  or any(not label.strip() for label in self.rounds.labels)
                                  or len(set(self.rounds.labels)) != len(self.rounds.labels)):
            raise ValueError("对照组名称必须非空、唯一，且数量与固定执行组数一致")
        return self

    def step(self, step_id: str) -> StepDef | None:
        return next((step for step in self.steps if step.id == step_id), None)

    def default_params(self) -> dict[str, object]:
        return {param.key: param.default for param in self.params}

    def params_of(self, params: dict[str, object] | None) -> dict[str, object]:
        """补上没有设置的参数：任务里只保存取值，缺的按默认值。"""
        return {**self.default_params(), **(params or {})}

    def check_params(self, params: dict[str, object]) -> list[str]:
        known = {param.key: param for param in self.params}
        problems = [f"未知参数：{key}" for key in params if key not in known]
        for key, value in params.items():
            if key in known:
                problem = known[key].check(value)
                if problem:
                    problems.append(problem)
        return problems

    @property
    def min_participants(self) -> int:
        return sum(role.min for role in self.roles.values())


def load_manifest(path: str | Path) -> Manifest:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    return Manifest.model_validate(data)
