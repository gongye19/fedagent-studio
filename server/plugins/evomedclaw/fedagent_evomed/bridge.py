"""上游 Agent 的模型调用桥：不读取任何提供者密钥，复用 SDK 的网关、缓存与取消语义。"""
from __future__ import annotations

import re
from collections import defaultdict
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from fedagent_sdk import Model, ModelError


@dataclass
class Bridge:
    model: Model
    usage: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def query(self, prompt: str, system: str, max_tokens: int) -> str:
        reply = self.model.chat([{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                                max_tokens=min(max_tokens, 4096), temperature=0)
        if not reply.text.strip():
            raise ModelError("医疗 Agent 返回了空内容")
        for key, value in reply.usage.items():
            if isinstance(value, int):
                self.usage[key] += value
        return reply.text.strip()


_active: ContextVar[Bridge | None] = ContextVar("evomed_sdk_bridge", default=None)


def current_bridge() -> Bridge:
    bridge = _active.get()
    if bridge is None:
        raise RuntimeError("医疗 Agent 未绑定本方模型")
    return bridge


@contextmanager
def use_model(model: Model):
    bridge = Bridge(model)
    token = _active.set(bridge)
    try:
        yield bridge
    finally:
        _active.reset(token)


def diagnose(item: dict[str, Any], memory: dict[str, Any] | None, model: Model, *, turns: int = 6,
             progress=None, item_id: str | None = None) -> tuple[dict[str, Any], dict[str, int]]:
    # 懒加载：其他算法不需要加载医疗运行时。
    from .vendor.runtime.department_first.core import (
        DepartmentFirstLocalAgent,
        DepartmentMemoryBank,
        DepartmentRouter,
        PromptComposer,
        PromptRegistry,
        StructuredOutputVerifier,
        run_department_first_interaction,
    )
    from .vendor.runtime.department_first.core.types import MemoryEntry
    from .vendor.runtime.department_first.standalone import MeasurementAgent, PatientAgent, StructuredScenario

    def evidence(key: str) -> dict[str, Any]:
        value = item.get(key, {})
        return value if isinstance(value, dict) else {key: value} if value else {}

    osce = {"Patient_Actor": item["patient"], "Objective_for_Doctor": item["objective"],
            "Physical_Examination_Findings": evidence("examination"), "Test_Results": evidence("tests"),
            "Correct_Diagnosis": ""}
    scenario = StructuredScenario({"OSCE_Examination": osce})
    bank = DepartmentMemoryBank(entries=[MemoryEntry(**entry) for entry in (memory or {}).get("entries", [])])
    composer = PromptComposer(PromptRegistry())
    verifier = StructuredOutputVerifier()
    doctor = DepartmentFirstLocalAgent(model.name, composer, memory_bank=bank, verifier=verifier,
                                      semantic_matching_enabled=False, max_infs=turns, min_questions_before_consult=6,
                                      max_consultations=2, must_question_after_consult=2)
    doctor.update_scenario(scenario)
    patient = PatientAgent(model.name)
    patient.update_scenario(scenario)
    measurement = MeasurementAgent(model.name)
    measurement.update_scenario(scenario)
    from .parallel import ParallelSpecialists
    specialists = ParallelSpecialists(model.name, composer, DepartmentRouter(mode="hybrid", model_name=model.name), bank, verifier,
                                             single_expert_mode=False, consultation_mode="multi", arbiter_mode="conflict_only",
                                             semantic_matching_enabled=False)
    from .progress import Trace

    trace = Trace(progress, item_id)
    if progress is not None:
        trace.attach(doctor, patient, measurement, specialists)
    with use_model(model) as bridge:
        result = run_department_first_interaction(scenario, doctor, specialists, patient, measurement,
                                                 None, turns, 0, 0, 1)
    prediction = str(result.get("predicted_diagnosis") or "").strip()
    final = re.match(r"^DIAGNOSIS READY\s*:\s*(.+)$", prediction, flags=re.I | re.S)
    unfinished = re.search(r"[?？]|REQUEST (?:TEST|CONSULTATION)|maximum inferences reached|Most likely working diagnosis", prediction, flags=re.I)
    if final is None or not final.group(1).strip() or unfinished:
        raise ModelError("问诊回合结束，但模型未形成最终诊断，请重试或调整问诊上限")
    trace.send(f"{trace.prefix}:diagnosis", "诊断完成", "completed", detail=final.group(1).strip())
    return result, dict(bridge.usage)
