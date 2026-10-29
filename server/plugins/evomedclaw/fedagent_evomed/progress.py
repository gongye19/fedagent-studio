"""在上游对象边界观察真实动作；不改 vendor、提示词、返回值或诊断分支。"""
from __future__ import annotations

import hashlib
import logging
import re
import threading
from collections.abc import Callable
from contextvars import ContextVar

DEPARTMENTS = {
    "pediatrics": "儿科", "gastro_hepatology": "消化肝病科", "infectious_disease": "感染科",
    "cardiology": "心内科", "neurology": "神经科", "hematology_oncology": "血液肿瘤科",
    "surgery_orthopedics": "外科／骨科", "dermatology": "皮肤科", "obgyn": "妇产科",
    "rheumatology": "风湿科", "general_internal_medicine": "综合内科", "emergency": "急诊科",
}


def public_text(value) -> str:
    text = re.sub(r"<(think|analysis|reasoning)\b[^>]*>.*?(</\1>|$)", "", str(value), flags=re.I | re.S).strip()
    return text if len(text) <= 5900 else text[:5880] + "\n…内容已截断"


class Trace:
    def __init__(self, emit: Callable | None, item_id: str | None):
        self.emit = emit
        self.item_id = item_id
        self.prefix = hashlib.sha256((item_id or "case").encode()).hexdigest()[:10]
        self.number = 0
        self._parent: ContextVar[str | None] = ContextVar("medical_progress_parent", default=None)
        self._lock = threading.Lock()

    def send(self, activity, title, status, *, summary="", detail="", parent=None):
        if self.emit:
            try:
                self.emit(activity, title, status, item_id=self.item_id, summary=public_text(summary)[:500],
                          detail=public_text(detail), parent=parent)
            except Exception:
                logging.getLogger(__name__).warning("Public progress sink unavailable")
                self.emit = None

    def observe(self, obj, method: str, title, describe=lambda value: ("", str(value))):
        original = getattr(obj, method)

        def call(*args, **kwargs):
            with self._lock:
                self.number += 1
                activity = f"{self.prefix}:{self.number}"
            label = title(kwargs) if callable(title) else title
            parent = self._parent.get()
            self.send(activity, label, "running", parent=parent)
            token = self._parent.set(activity)
            try:
                value = original(*args, **kwargs)
                try:
                    summary, detail = describe(value)
                    self.send(activity, label, "completed", summary=summary, detail=detail, parent=parent)
                except Exception:
                    logging.getLogger(__name__).warning("Public progress summary unavailable")
                return value
            except Exception:
                self.send(activity, label, "failed", summary="本步骤未完成，请查看任务状态", parent=parent)
                raise
            finally:
                self._parent.reset(token)
        setattr(obj, method, call)

    def attach(self, doctor, patient, measurement, specialists):
        self.observe(doctor, "inference_local", "医生问诊", lambda v: ("已生成下一步诊疗动作", v))
        self.observe(patient, "inference_patient", "患者回复", lambda v: ("已收到患者回复", v))
        self.observe(measurement, "inference_measurement", "检查结果", lambda v: ("已返回请求的检查结果", v))
        self.observe(specialists, "consult", "专家会诊", lambda v: (
            "已完成会诊" + (" · 已进行分歧仲裁" if v.arbiter_used else ""), v.final_opinion))
        self.observe(specialists, "route", "科室分诊", lambda v: (
            "、".join(str(DEPARTMENTS.get(d, d)) for d in v.departments() if d),
            "分诊方式：" + v.routing_method + "\n" + "\n".join(v.reasons)))
        self.observe(specialists, "_query_specialist", lambda k: f"{DEPARTMENTS.get(k['department'], k['department'])} · 专家 {k['expert_index']}",
                     lambda v: ("已返回专家意见", v))
        self.observe(specialists, "_query_department_consensus", lambda k: f"{DEPARTMENTS.get(k['department'], k['department'])} · 汇总意见",
                     lambda v: ("已汇总本科专家意见", v))
        self.observe(specialists.arbiter, "arbitrate", "分歧仲裁", lambda v: ("已返回仲裁意见", v))
