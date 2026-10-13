"""注册表：发现并校验插件，提供三种场景的规则。

插件通过包的 entry point 注册（fedagent.algorithms、fedagent.task_types、fedagent.graders），平台启动时加载；
算法插件在构造时校验清单和步骤实现，有问题直接报错，不带着坏插件启动。
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from importlib.metadata import entry_points
from typing import Any

from fedagent_sdk import SERVER, Algorithm, Grader, TaskType


@dataclass(frozen=True)
class Scenario:
    id: str
    name: str
    short: str
    summary: str
    roles: str
    """角色规则的说明（只用于展示）。"""


SCENARIOS: tuple[Scenario, ...] = (
    Scenario("horizontal", "横向联邦 Agent", "横向联邦", "各方做同类任务、数据不同，只共享经验，一起提升", "只有参与方一种角色，地位相同"),
    Scenario("vertical", "纵向联邦 Agent", "纵向联邦", "同一批对象，信息分散在各方，结合起来才能回答", "发起方（持有问题和标注）+ 数据提供方"),
    Scenario("transfer", "联邦迁移 Agent", "联邦迁移", "把已有参与方的经验，迁移到新领域", "源方 + 目标方"),
)


class PluginError(RuntimeError):
    pass


class Registry:
    def __init__(self, algorithms: dict[str, Algorithm], task_types: dict[str, TaskType], graders: dict[str, Grader]) -> None:
        self.algorithms = algorithms
        self.task_types = task_types
        self.graders = graders
        for algorithm in algorithms.values():
            manifest = algorithm.manifest
            if manifest.scenario not in {item.id for item in SCENARIOS}:
                raise PluginError(f"算法 {manifest.id} 的场景 {manifest.scenario} 不存在")
            if manifest.scenario == "horizontal" and len(manifest.roles) != 1:
                raise PluginError(f"算法 {manifest.id}：横向场景只有一种角色")
        for task_type in task_types.values():
            missing = [grader for grader in task_type.graders if grader not in graders]
            if missing:
                raise PluginError(f"任务类型 {task_type.id} 用到的判分方式没有安装：{', '.join(missing)}")

    @classmethod
    def discover(cls) -> Registry:
        algorithms: dict[str, Algorithm] = {}
        for entry in entry_points(group="fedagent.algorithms"):
            plugin = entry.load()()
            if not isinstance(plugin, Algorithm):
                raise PluginError(f"{entry.value} 不是 Algorithm")
            algorithms[plugin.id] = plugin
        task_types: dict[str, TaskType] = {}
        for entry in entry_points(group="fedagent.task_types"):
            task_type = entry.load()()
            task_types[task_type.id] = task_type
        graders: dict[str, Grader] = {}
        for entry in entry_points(group="fedagent.graders"):
            grader = entry.load()()
            graders[grader.id] = grader
        return cls(algorithms, task_types, graders)

    # —— 查询 ——

    def algorithm(self, algorithm_id: str) -> Algorithm:
        try:
            return self.algorithms[algorithm_id]
        except KeyError as error:
            raise PluginError(f"算法 {algorithm_id} 没有安装") from error

    def model_settings(self) -> dict[str, Any]:
        """检查模型接口时用的生成参数：各算法里最严格的（最大的 max_tokens，用到的 temperature、top_p）。"""
        merged: dict[str, Any] = {}
        for algorithm in self.algorithms.values():
            for key, value in algorithm.model_settings().items():
                current = merged.get(key)
                merged[key] = max(current, value) if isinstance(current, int | float) and isinstance(value, int | float) else value
        return merged or {"max_tokens": 16}

    def task_type(self, task_type_id: str) -> TaskType:
        try:
            return self.task_types[task_type_id]
        except KeyError as error:
            raise PluginError(f"任务类型 {task_type_id} 没有安装") from error

    def grader(self, grader_id: str) -> Grader:
        try:
            return self.graders[grader_id]
        except KeyError as error:
            raise PluginError(f"判分方式 {grader_id} 没有安装") from error

    def scenario(self, scenario_id: str) -> Scenario | None:
        return next((item for item in SCENARIOS if item.id == scenario_id), None)

    def scenario_available(self, scenario_id: str) -> bool:
        return any(algorithm.manifest.scenario == scenario_id for algorithm in self.algorithms.values())

    def algorithms_for(self, scenario: str, task_type: str | None = None) -> list[Algorithm]:
        return [
            algorithm
            for algorithm in self.algorithms.values()
            if algorithm.manifest.scenario == scenario and (task_type is None or task_type in algorithm.manifest.accepts)
        ]

    def task_types_for(self, scenario: str) -> list[str]:
        return [task_type for task_type in self.task_types if self.algorithms_for(scenario, task_type)]

    # —— 给前端的描述 ——

    def describe_algorithm(self, algorithm: Algorithm) -> dict[str, Any]:
        """前端注册表（app/src/domain/catalog.ts 的 Algorithm）用的字段。"""
        manifest = algorithm.manifest
        channel = next(iter(manifest.channels.values()), None)
        return {
            "id": manifest.id,
            "version": manifest.version,
            "scenario": manifest.scenario,
            "name": manifest.name,
            "fullName": manifest.full_name,
            "summary": manifest.summary,
            "exchange": channel.label if channel else "",
            "output": {"name": manifest.artifact.name, "unit": manifest.artifact.unit} if manifest.artifact else None,
            "stages": [
                {
                    "id": step.id,
                    "label": step.label,
                    "side": "server" if step.at == SERVER else "participant",
                    "role": step.at,
                    "per": step.per,
                    "result": step.result,
                    "seconds": step.estimate.seconds,
                    "tokens": step.estimate.tokens or None,
                    "model": step.model,
                }
                for step in manifest.steps
            ],
            "accepts": list(manifest.accepts),
            "roles": {key: role.model_dump() for key, role in manifest.roles.items()},
            "params": [param.model_dump(exclude_none=False) for param in manifest.params],
            "minParticipants": manifest.min_participants,
            "minSamples": algorithm.min_samples_per_site,
            "minRounds": manifest.rounds.min,
            "maxRounds": manifest.rounds.max,
            "defaultRounds": manifest.rounds.default,
            "requirements": {
                "dataRequired": True,
                "minSources": manifest.min_participants,
                "minSamples": algorithm.min_samples_per_site,
                "participantModel": any(step.at != SERVER and step.model for step in manifest.steps),
                "serverModel": any(step.at == SERVER and step.model for step in manifest.steps),
                "executionLabel": f"{manifest.name} 执行流程",
                "executionModes": ["platform", "local"],
            },
            "source": {
                "paper": manifest.source.paper,
                "paperUrl": manifest.source.paper_url,
                "code": manifest.source.code,
                "codeUrl": manifest.source.code_url,
            },
        }

    def describe_task_type(self, task_type: TaskType) -> dict[str, Any]:
        default = self.graders[task_type.graders[0]] if task_type.graders else None
        return {
            "id": task_type.id,
            "label": task_type.label,
            "metric": task_type.metric,
            "grader": default.id if default else None,
            "graders": [{"id": grader, "label": self.graders[grader].label, "detail": self.graders[grader].detail} for grader in task_type.graders],
            "format": task_type.format_hint,
            "unlabeledNote": task_type.unlabeled_note,
            "placeholder": task_type.placeholder,
            "schemaVersion": task_type.schema_version,
            "structuredInput": task_type.structured_input,
            "inputLabel": task_type.input_label,
            "answerLabel": task_type.answer_label,
            "inputFields": [field.to_dict() for field in task_type.input_fields],
        }

    def describe(self) -> dict[str, Any]:
        return {
            "scenarios": [
                {
                    "id": item.id,
                    "name": item.name,
                    "short": item.short,
                    "summary": item.summary,
                    "status": "available" if self.scenario_available(item.id) else "planned",
                }
                for item in SCENARIOS
            ],
            "taskTypes": [self.describe_task_type(task_type) for task_type in self.task_types.values()],
            "algorithms": [self.describe_algorithm(algorithm) for algorithm in self.algorithms.values()],
        }


@lru_cache
def get_registry() -> Registry:
    return Registry.discover()
