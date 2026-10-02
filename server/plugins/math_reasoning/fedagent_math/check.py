"""数据文件检查：和前端上传检查（app/src/domain/validate.ts）同一套规则。

id、question 必填，answer 可选（只用于评分）；其他字段保留但不使用（例如复现包里的 agent）。
"""

from __future__ import annotations

from typing import Any

from fedagent_sdk import CheckReport, Row


def _is_answer(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, str):
        return value.strip() != ""
    return isinstance(value, int | float) and value == value and value not in (float("inf"), float("-inf"))


def check_rows(rows: list[Row]) -> CheckReport:
    report = CheckReport()
    seen: dict[str, int] = {}
    for row in rows:
        if row.error is not None:
            report.add(row.line, row.error)
            continue
        record = row.data
        if not isinstance(record, dict):
            report.add(row.line, "每行应是一个 JSON 对象")
            continue
        identifier = record.get("id")
        if not ((isinstance(identifier, str) and identifier.strip()) or (isinstance(identifier, int | float) and not isinstance(identifier, bool))):
            report.add(row.line, "缺少 id")
            continue
        question = record.get("question")
        if not isinstance(question, str) or not question.strip():
            report.add(row.line, "缺少 question，或 question 不是文本")
            continue
        answer = record.get("answer")
        if answer is not None and not _is_answer(answer):
            report.add(row.line, "answer 应是文本或数字")
            continue
        key = str(identifier)
        if key in seen:
            report.add(row.line, f"id 与第 {seen[key]} 行重复")
            continue
        seen[key] = row.line
        item = {**record, "id": key}
        if _is_answer(answer):
            item["answer"] = str(answer)
            report.answered += 1
        report.count += 1
        report.items.append(item)
        if report.sample is None:
            report.sample = {"question": question.strip(), "answer": str(answer) if _is_answer(answer) else None}
    if report.count == 0 and report.issue_count == 0:
        report.add(0, "文件里没有题目")
    return report
