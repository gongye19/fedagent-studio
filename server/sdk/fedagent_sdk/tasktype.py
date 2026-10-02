"""任务类型和判分插件的基类。

任务类型决定一条样本的格式、哪些字段是标注、主要指标和可用的判分方式；
判分方式给一个预测和一条样本打分，在持有标注的一方执行（平台托管的在平台，本地参与方在客户端）。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, ClassVar, Literal

MAX_ISSUES = 5


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

    def check(self, rows: list[Row]) -> CheckReport:
        raise NotImplementedError

    def item_id(self, item: Mapping[str, Any]) -> str:
        return str(item["id"])

    def is_labeled(self, item: Mapping[str, Any]) -> bool:
        return all(_present(item.get(name)) for name in self.label_fields)

    def strip_labels(self, item: Mapping[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in item.items() if key not in self.label_fields}

    def input_of(self, item: Mapping[str, Any]) -> str:
        """一条样本的输入文本（试用、日志用）。"""
        raise NotImplementedError


class Grader:
    id: ClassVar[str]
    label: ClassVar[str]
    detail: ClassVar[str] = ""
    isolation: ClassVar[Literal["none", "sandbox"]] = "none"
    """要执行代码的判分标 sandbox，由隔离环境执行。"""

    def grade(self, prediction: Any, item: Mapping[str, Any]) -> bool:
        raise NotImplementedError


def _present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    return True
