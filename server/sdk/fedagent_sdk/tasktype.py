"""任务类型和判分插件的基类。

任务类型决定一条样本的格式、哪些字段是标注、主要指标和可用的判分方式；
判分方式给一个预测和一条样本打分，在持有标注的一方执行（平台托管的在平台，本地参与方在客户端）。
"""

from __future__ import annotations

import copy
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, ClassVar, Literal

from .model import Model

MAX_ISSUES = 5


@dataclass(frozen=True)
class InputField:
    key: str
    label: str
    kind: Literal["text", "textarea", "json"] = "textarea"
    required: bool = True
    help: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"key": self.key, "label": self.label, "kind": self.kind, "required": self.required, "help": self.help}


@dataclass(frozen=True)
class Row:
    """数据文件里的一行：解析成功时 data 有值，否则 error 写明原因。line 从 1 开始。"""

    line: int
    data: dict[str, Any] | None
    error: str | None = None


@dataclass(frozen=True)
class CheckIssue:
    line: int
    message: str


@dataclass
class CheckReport:
    count: int = 0
    answered: int = 0
    issues: list[CheckIssue] = field(default_factory=list)
    issue_count: int = 0
    sample: dict[str, Any] | None = None
    items: list[dict[str, Any]] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.issue_count == 0 and self.count > 0

    def add(self, line: int, message: str) -> None:
        self.issue_count += 1
        if len(self.issues) < MAX_ISSUES:
            self.issues.append(CheckIssue(line, message))


class TaskType:
    id: ClassVar[str]
    label: ClassVar[str]
    metric: ClassVar[str]
    """主要指标的名称，例如准确率。"""
    higher_is_better: ClassVar[bool] = True
    label_fields: ClassVar[tuple[str, ...]] = ()
    """标注字段：算法步骤默认看不到，只有判分能读。"""
    graders: ClassVar[tuple[str, ...]] = ()
    """可用的判分方式，第一个是默认。"""
    format_hint: ClassVar[str] = ""
    """一条样本的格式，写在上传框里。"""
    unlabeled_note: ClassVar[str] = ""
    placeholder: ClassVar[str] = ""
    """应用试用时输入框的提示。"""
    schema_version: ClassVar[str] = "1.0"
    input_fields: ClassVar[tuple[InputField, ...]] = ()
    input_label: ClassVar[str] = "输入"
    answer_label: ClassVar[str] = "参考答案"
    structured_input: ClassVar[bool] = False
    template: ClassVar[list[dict[str, Any]]] = []

    def preview(self, item: Mapping[str, Any]) -> list[dict[str, str]]:
        """仅供资源预览；具体类型可覆盖，核心不假设 question／answer。"""
        return [{"label": self.input_label, "text": self.input_of(item)}]

    def application_item(self, value: str | dict[str, Any], answer: str | None = None) -> dict[str, Any]:
        """从应用输入构造本任务类型的评测样本；标注不交给 apply。"""
        if not isinstance(value, str) or not value.strip():
            raise ValueError("请填写输入文本")
        report = self.check([Row(1, {"id": "apply", "question": value.strip(), "answer": answer.strip() if answer and answer.strip() else None})])
        if not report.ok:
            raise ValueError(report.issues[0].message)
        return report.items[0]

    def application_input(self, item: Mapping[str, Any]) -> str | dict[str, Any]:
        return self.strip_labels(item) if self.structured_input else self.input_of(item)

    def check(self, rows: list[Row]) -> CheckReport:
        raise NotImplementedError

    def item_id(self, item: Mapping[str, Any]) -> str:
        return str(item["id"])

    def is_labeled(self, item: Mapping[str, Any]) -> bool:
        def get(path: str) -> Any:
            value: Any = item
            for name in path.split("."):
                value = value.get(name) if isinstance(value, Mapping) else None
            return value
        return bool(self.label_fields) and all(_present(get(name)) for name in self.label_fields)

    def is_evaluated(self, item: Mapping[str, Any]) -> bool:
        """任务评测分母；有独立学习集的任务类型可排除学习样本。"""
        return self.is_labeled(item)

    def labels_allowed(self, item: Mapping[str, Any]) -> bool:
        """声明 labels 的学习步骤可读取哪些样本的标注；评测集可覆盖为 False。"""
        return True

    def strip_labels(self, item: Mapping[str, Any]) -> dict[str, Any]:
        result = copy.deepcopy(dict(item))
        for path in self.label_fields:
            parts = path.split(".")
            parent = result
            for name in parts[:-1]:
                child = parent.get(name)
                if not isinstance(child, dict):
                    break
                parent = child
            else:
                parent.pop(parts[-1], None)
        return result

    def input_of(self, item: Mapping[str, Any]) -> str:
        """一条样本的输入文本（试用、日志用）。"""
        raise NotImplementedError


class Grader:
    id: ClassVar[str]
    label: ClassVar[str]
    detail: ClassVar[str] = ""
    requires_model: ClassVar[bool] = False
    isolation: ClassVar[Literal["none", "sandbox"]] = "none"
    """要执行代码的判分标 sandbox，由隔离环境执行。"""

    def grade(self, prediction: Any, item: Mapping[str, Any]) -> bool:
        raise NotImplementedError

    def evaluate(self, prediction: Any, item: Mapping[str, Any], model: Model | None = None) -> bool:
        """可选模型判分；既有确定性判分器无需修改。标注仅交给独立判分器。"""
        return self.grade(prediction, item)


def _present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    return True
