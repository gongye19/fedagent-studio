"""上传的是已发生的过程，而不是预先提炼好的经验或供平台重跑的原始题。"""
from __future__ import annotations

import copy
import json
from collections.abc import Mapping
from typing import Any, ClassVar

from fedagent_evomed.medical import MedicalDiagnosis, normalize_case
from fedagent_math import MathReasoning
from fedagent_sdk import CheckReport, Row, TaskType


class ProcessRecords(TaskType):
    record_based = True
    schema_version = "process-record/1.0"
    label_fields = ("answer",)
    unlabeled_note = "过程记录用于经验生成；应用效果须用未参与学习的新问题独立验证"
    format_hint = '{"id", "input", "events": [{"role", "content"}], "output", "answer"（可选）, "provenance"（可选）}'
    reference_required = False
    domain: ClassVar[TaskType]

    def check(self, rows: list[Row]) -> CheckReport:
        report = CheckReport()
        seen: set[str] = set()
        for row in rows:
            try:
                if row.error or not isinstance(row.data, dict):
                    raise ValueError(row.error or "每行应是一个 JSON 对象")
                value = row.data
                identifier = value.get("id")
                if isinstance(identifier, bool) or not isinstance(identifier, str | int) or not str(identifier).strip():
                    raise ValueError("id：请填写记录编号")
                identifier = str(identifier)
                if identifier in seen:
                    raise ValueError("id：记录编号重复")
                input_ = value.get("input")
                if isinstance(self.domain, MedicalDiagnosis):
                    if not isinstance(input_, dict):
                        raise ValueError("input：医疗过程需要病例对象")
                    if any(k in input_ for k in ("answer", "Correct_Diagnosis", "correct_diagnosis")):
                        raise ValueError("input 中不能包含参考诊断；请放在顶层 answer")
                    input_ = self.domain.strip_labels(normalize_case({**input_, "id": identifier}))
                    input_.pop("split", None)
                elif not isinstance(input_, str) or not input_.strip():
                    raise ValueError("input：请填写题目")
                events = value.get("events")
                if not isinstance(events, list) or not 1 <= len(events) <= 200:
                    raise ValueError("events：需要 1–200 条实际过程记录，只有病例或题目不够")
                if isinstance(self.domain, MedicalDiagnosis) and not any(
                    event.get("role") in ("doctor", "LocalDoctor") for event in events if isinstance(event, dict)
                ):
                    raise ValueError("events：问诊过程需要 doctor 角色的实际问诊步骤")
                for event in events:
                    if not isinstance(event, dict) or not all(isinstance(event.get(k), str) and event[k].strip() for k in ("role", "content")):
                        raise ValueError("events：每一步需要非空 role 和 content")
                    if len(event['role']) > 80 or ('stage' in event and (not isinstance(event['stage'], str) or len(event['stage']) > 80)):
                        raise ValueError("events：role 和 stage 应为不超过 80 字符的文本")
                    if len(event["content"]) > 20000:
                        raise ValueError("events：单步内容超过 20000 字符")
                output = value.get("output")
                if not isinstance(output, str) or not output.strip() or len(output) > 40000:
                    raise ValueError("output：需要有效的最终回答（最多 40000 字符）")
                answer = value.get("answer")
                if self.reference_required and not answer:
                    raise ValueError("answer：问诊过程需要参考诊断来校验经验；不提供给应用作答")
                if answer is not None and (not isinstance(answer, str) or not answer.strip()):
                    raise ValueError("answer：有参考答案时应为非空文本，没有时请省略")
                provenance = value.get("provenance", {})
                if not isinstance(provenance, dict) or len(json.dumps(provenance, ensure_ascii=False)) > 4000:
                    raise ValueError("provenance：来源应为不超过 4000 字符的对象")
                if len(json.dumps(value, ensure_ascii=False)) > 100000:
                    raise ValueError("单条过程记录过长")
                item = {"id": identifier, "input": input_,
                        "events": [{k: event[k] for k in ("role", "content", "stage") if k in event} for event in events], "output": output.strip(),
                        "provenance": copy.deepcopy(provenance)}
                if answer is not None:
                    item["answer"] = answer.strip()
                seen.add(identifier)
                report.items.append(item)
                report.count += 1
                report.answered += int(answer is not None)
            except (ValueError, TypeError, RecursionError) as error:
                report.add(row.line, str(error))
        report.sample = report.items[0] if report.items else None
        return report

    def sample_purpose(self, item: Mapping[str, Any]) -> str:
        return "过程记录"

    def is_evaluated(self, item: Mapping[str, Any]) -> bool:
        return False

    def input_of(self, item: Mapping[str, Any]) -> str:
        value = item["input"]
        return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)

    def application_item(self, value, answer=None):
        return self.domain.application_item(value, answer)

    def application_input(self, item):
        return self.domain.application_input(item)

    def preview(self, item):
        return [{"label": "输入", "text": self.input_of(item)},
                {"label": "过程", "text": f"{len(item['events'])} 步"}, {"label": "最终回答", "text": item["output"]}]


class MathRecords(ProcessRecords):
    id = "math-records"
    label = "数学推理"
    domain = MathReasoning()
    metric = domain.metric
    graders = domain.graders
    placeholder = domain.placeholder
    input_fields = domain.input_fields
    input_label = domain.input_label
    answer_label = domain.answer_label
    template: ClassVar[list[dict[str, Any]]] = [{"id": "", "input": "", "events": [{"role": "solver", "content": ""}], "output": "", "answer": ""}]


class MedicalRecords(ProcessRecords):
    id = "medical-records"
    label = "医疗问诊"
    domain = MedicalDiagnosis()
    structured_input = True
    metric = domain.metric
    graders = domain.graders
    placeholder = domain.placeholder
    input_fields = domain.input_fields
    input_label = domain.input_label
    answer_label = domain.answer_label
    reference_required = True
    format_hint = ('{"id", "input": {"patient", "objective", "examination", "tests"}, '
                   '"events": [{"role", "content", "stage"（可选）}], "output", "answer", "provenance"（可选）}')
    unlabeled_note = "需包含 doctor 的实际问诊过程和参考诊断；过程用于生成经验，新病例在应用中独立验证"

    template: ClassVar[list[dict[str, Any]]] = [{"id": "", "input": {"patient": "", "objective": "", "tests": {}, "examination": {}},
                 "events": [{"role": "doctor", "content": ""}, {"role": "patient", "content": ""}], "output": "", "answer": ""}]
