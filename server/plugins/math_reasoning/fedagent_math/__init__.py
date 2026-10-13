"""任务类型插件：数学推理。

一条样本是 {"id", "question", "answer"}，answer 可选；指标是准确率。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, ClassVar

from fedagent_sdk import CheckReport, Grader, InputField, Row, TaskType

from .check import check_rows
from .grading import paper_grade, strict_grade


class MathReasoning(TaskType):
    id = "math-reasoning"
    label = "数学推理"
    metric = "准确率"
    label_fields = ("answer",)
    graders = ("math-answer", "math-answer-strict")
    format_hint = '{"id", "question", "answer"}'
    unlabeled_note = "没有 answer 的样本不计入指标"
    placeholder = "输入一道数学题…"
    input_label = "问题"
    answer_label = "标准答案"
    input_fields = (InputField("question", "问题"),)
    template: ClassVar[list[dict[str, Any]]] = [{"id": "", "question": "", "answer": ""}]

    def preview(self, item: Mapping[str, Any]) -> list[dict[str, str]]:
        fields = [{"label": "问题", "text": str(item.get("question", ""))}]
        if item.get("answer") is not None:
            fields.append({"label": "标注", "text": str(item["answer"])})
        return fields

    def check(self, rows: list[Row]) -> CheckReport:
        return check_rows(rows)

    def input_of(self, item: Mapping[str, Any]) -> str:
        return str(item["question"])


class PaperCompatibleGrader(Grader):
    id = "math-answer"
    label = "答案比对"
    detail = "抽取 \\boxed{} 里的答案，规范化后与标准答案比较（论文兼容口径）"

    def grade(self, prediction: Any, item: Mapping[str, Any]) -> bool:
        return paper_grade(str(prediction or ""), item)


class StrictGrader(Grader):
    id = "math-answer-strict"
    label = "答案比对（严格）"
    detail = "只认最后一个 \\boxed{} 里的答案，规范化后整体相等才算对"

    def grade(self, prediction: Any, item: Mapping[str, Any]) -> bool:
        return strict_grade(str(prediction or ""), item)


__all__ = ["MathReasoning", "PaperCompatibleGrader", "StrictGrader"]
