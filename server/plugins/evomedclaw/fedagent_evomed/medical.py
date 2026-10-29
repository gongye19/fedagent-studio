"""医疗病例规范；同时接受规范 JSONL 和 MedAgentSim 的 OSCE 文本病例。"""
from __future__ import annotations

import copy
import json
import math
import re
from collections.abc import Mapping
from typing import Any, ClassVar

from fedagent_sdk import CheckReport, Grader, InputField, Row, TaskType


def text_of(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def normalize_case(record: dict[str, Any], *, fallback_id: str | None = None) -> dict[str, Any]:
    if "OSCE_Examination" in record:
        osce = record["OSCE_Examination"]
        if not isinstance(osce, dict):
            raise ValueError("OSCE_Examination 应为对象")
        if any(key in record for key in ("image_url", "image_path", "image")) or any("image" in key.lower() for key in osce):
            raise ValueError("当前只支持文本病例，含影像的病例需使用多模态适配")
        record = {
            "id": record.get("id", record.get("scenario_id", fallback_id)),
            "patient": osce.get("Patient_Actor"),
            "objective": osce.get("Objective_for_Doctor"),
            "examination": osce.get("Physical_Examination_Findings", {}),
            "tests": osce.get("Test_Results", {}),
            "answer": osce.get("Correct_Diagnosis"),
            "split": record.get("split"),
        }
    identifier = record.get("id")
    if isinstance(identifier, bool) or not isinstance(identifier, str | int) or not str(identifier).strip():
        raise ValueError("id：请填写病例编号")
    result: dict[str, Any] = {"id": str(identifier)}
    for key, label in (("patient", "病人信息"), ("objective", "诊断目标"), ("examination", "查体"), ("tests", "检查结果")):
        value = record.get(key, {} if key in ("examination", "tests") else None)
        if not isinstance(value, str | dict):
            raise ValueError(f"{key}（{label}）：应为文本或对象")
        if key in ("patient", "objective") and not text_of(value).strip().strip("{}"):
            raise ValueError(f"{key}（{label}）：不能为空")
        result[key] = copy.deepcopy(value)
    answer = record.get("answer")
    if answer is not None and (not isinstance(answer, str) or not answer.strip()):
        raise ValueError("answer：参考诊断应为非空文本；没有标注时请省略此字段")
    if answer is not None:
        result["answer"] = answer.strip()
    split = record.get("split")
    if split is not None and split not in ("learn", "eval"):
        raise ValueError("split：只能是 learn（经验生成）或 eval（独立评测）")
    if split:
        result["split"] = split
    return result


def _remove_reserved(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _remove_reserved(child) for key, child in value.items()
                if key.lower().replace("_", "") not in {"answer", "correctdiagnosis", "referenceanswer", "referencediagnosis"}}
    if isinstance(value, list):
        return [_remove_reserved(child) for child in value]
    return value


class MedicalDiagnosis(TaskType):
    id = "medical-diagnosis"
    label = "医疗诊断"
    metric = "诊断匹配率"
    label_fields = ("answer",)
    graders = ("diagnosis-clinical", "diagnosis-exact")
    structured_input = True
    input_label = "病例"
    answer_label = "参考诊断"
    format_hint = '{"id", "patient", "objective", "examination", "tests", "answer", "split"}；也可上传 MedAgentSim OSCE JSONL'
    unlabeled_note = "经验生成病例需要参考诊断；未指定 split 时按文件顺序留出末尾 20% 作独立评测；至少 2 条病例"
    placeholder = "填写病人信息与诊断目标"
    input_fields = (
        InputField("patient", "病人信息", help="主诉、病史和病人可回答的信息。不要在这里放参考诊断。"),
        InputField("objective", "诊断目标"),
        InputField("examination", "查体", required=False),
        InputField("tests", "检查结果", kind="json", required=False, help="JSON 对象，键为检查名称，值为实际检查结果；没有时可留空。"),
    )
    template: ClassVar[list[dict[str, Any]]] = [
        {"id": "", "patient": "", "objective": "", "examination": {}, "tests": {}, "answer": "", "split": "learn"},
        {"id": "", "patient": "", "objective": "", "examination": {}, "tests": {}, "answer": "", "split": "eval"},
    ]

    def check(self, rows: list[Row]) -> CheckReport:
        report = CheckReport()
        seen: dict[str, int] = {}
        for row in rows:
            if row.error or row.data is None:
                report.add(row.line, row.error or "每行应是一个对象")
                continue
            try:
                item = normalize_case(row.data, fallback_id=f"case-{row.line}")
                if item["id"] in seen:
                    raise ValueError(f"id 与第 {seen[item['id']]} 行重复")
            except ValueError as error:
                report.add(row.line, str(error))
                continue
            seen[item["id"]] = row.line
            report.items.append(item)
            report.count += 1
            report.answered += int(self.is_labeled(item))
        if report.issue_count:
            return report
        if report.count < 2:
            report.add(0, "至少需要 2 条病例，分别用于经验生成与独立评测")
            return report
        explicit = ["split" in item for item in report.items]
        if any(explicit) and not all(explicit):
            report.add(0, "指定 split 时请为每条病例指定 learn 或 eval")
            return report
        if not any(explicit):
            cutoff = report.count - max(1, math.ceil(report.count * 0.2))
            for index, item in enumerate(report.items):
                item["split"] = "learn" if index < cutoff else "eval"
        learning = [item for item in report.items if item["split"] == "learn"]
        evaluation = [item for item in report.items if item["split"] == "eval"]
        if not learning or not evaluation:
            report.add(0, "数据必须同时包含经验生成病例（learn）和独立评测病例（eval）")
        for item in learning:
            if not self.is_labeled(item):
                report.add(seen[item["id"]], "answer：经验生成病例需要参考诊断来验证经验")
        learned_inputs = {json.dumps({key: item[key] for key in ("patient", "objective", "examination", "tests")}, sort_keys=True)
                          for item in learning}
        for item in evaluation:
            fingerprint = json.dumps({key: item[key] for key in ("patient", "objective", "examination", "tests")}, sort_keys=True)
            if fingerprint in learned_inputs:
                report.add(seen[item["id"]], "独立评测病例与经验生成病例内容重复，请换用未参与经验生成的病例")
        # 试跑取前 N 条时，优先保留一条经验病例和一条独立评测病例。
        if learning and evaluation:
            first = [learning[0], evaluation[0]]
            report.items = first + [item for item in report.items if item is not first[0] and item is not first[1]]
        report.sample = report.items[0] if report.items else None
        return report

    def sample_purpose(self, item: Mapping[str, Any]) -> str:
        return "经验生成" if item.get("split") == "learn" else "独立评测"

    def is_evaluated(self, item: Mapping[str, Any]) -> bool:
        return item.get("split") == "eval" and self.is_labeled(item)

    def labels_allowed(self, item: Mapping[str, Any]) -> bool:
        return item.get("split") == "learn"

    def strip_labels(self, item: Mapping[str, Any]) -> dict[str, Any]:
        return _remove_reserved(super().strip_labels(item))

    def input_of(self, item: Mapping[str, Any]) -> str:
        return text_of(self.strip_labels(item))

    def application_item(self, value: str | dict[str, Any], answer: str | None = None) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("医疗诊断需要结构化病例，请填写病例字段")
        result = normalize_case({**value, "id": "apply"})
        if answer and answer.strip():
            result["answer"] = answer.strip()
        return result

    def preview(self, item: Mapping[str, Any]) -> list[dict[str, str]]:
        fields = [{"label": field.label, "text": text_of(item[field.key])}
                  for field in self.input_fields if item.get(field.key) not in (None, "", {})]
        if item.get("answer"):
            fields.append({"label": "参考诊断", "text": str(item["answer"])})
        if item.get("split"):
            fields.append({"label": "用途", "text": "经验生成" if item["split"] == "learn" else "独立评测"})
        return fields


class DiagnosisExactGrader(Grader):
    id = "diagnosis-exact"
    label = "诊断名称匹配"
    detail = "去掉诊断前缀、大小写与标点后匹配完整名称；参考诊断可用 | 分隔明确的别名。此指标不是临床有效性评价。"

    def grade(self, prediction: Any, item: Mapping[str, Any]) -> bool:
        def clean(text: str) -> str:
            text = re.sub(r"^\s*DIAGNOSIS READY\s*:\s*", "", text, flags=re.I)
            return re.sub(r"[^\w]", "", text.casefold())
        answer = str(item.get("answer") or "")
        predicted = clean(str(prediction or ""))
        return bool(predicted and any(predicted == clean(alias) for alias in answer.split("|") if clean(alias)))
