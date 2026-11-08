"""读取固定公开留出病例，由服务端按动作返回已有资料。"""
import hashlib
import json
import re
from difflib import SequenceMatcher
from typing import Any

from fedagent_evomed.medical import normalize_case
from sqlalchemy.orm import Session

from .. import models as m
from ..errors import ServiceError
from ..platform import Platform
from ..schemas.consultation_comparison import Action, ComparisonCase
from .cases import case_fingerprint, redact_reference, source_sites, training_records

CASE = ComparisonCase(
    id="medqa-ext-141",
    title="9 岁男孩多尿、嗜盐",
    opening="9 岁男孩由母亲带来就诊。几个月来常觉得乏力，尿量和饮水量增多，还常想吃咸的食物。",
)
CASE_SHA256 = "24d0895867bdb336c511e587cd4b3ef88974f17b3eb9eae3edc30a12f69769c7"
SOURCE_SHA256 = "54a024eb2705c6c55d1988766adf4ab02ea7bbe2a28f843107b740032200f232"
SOURCE_INDEX = 140
REFERENCE_LABEL = "Bartter 综合征"

LABELS = {
    "History": "症状经过", "Symptoms": "伴随症状", "Past_Medical_History": "既往史",
    "Social_History": "生活背景", "Review_of_Systems": "系统回顾",
    "Vital_Signs": "生命体征", "General_Examination": "一般查体与生长情况",
    "Abdominal_Examination": "腹部查体", "Other_Findings": "其余查体",
    "Urinalysis": "尿液检查", "Serum_Electrolytes": "血电解质",
    "Plasma_Renin_Activity": "血浆肾素活性", "Plasma_Aldosterone_Concentration": "血浆醛固酮",
    "Pulse": "脉搏", "Blood_Pressure": "血压", "Respiratory_Rate": "呼吸频率",
    "Growth_Parameters": "生长指标", "Skin": "皮肤", "Urinary_Calcium_Excretion": "尿钙排泄",
    "Sodium": "血钠", "Potassium": "血钾", "Chloride": "血氯",
    "Primary_Symptom": "主诉", "Secondary_Symptoms": "伴随症状",
}


def load_case(platform: Platform, case_id: str) -> dict:
    if case_id != CASE.id:
        raise ServiceError(404, "留出病例不存在")
    try:
        raw = (platform.settings.data_dir / "consultation-cases" / f"{CASE.id}.json").read_bytes()
        if hashlib.sha256(raw).hexdigest() != CASE_SHA256:
            raise ValueError("病例内容与公开版本不一致")
        return normalize_case(json.loads(raw), fallback_id=CASE.id)
    except (OSError, ValueError) as error:
        raise ServiceError(409, "留出病例原档未安装或校验失败") from error


def available_cases(platform: Platform) -> list[ComparisonCase]:
    try:
        load_case(platform, CASE.id)
    except ServiceError:
        return []
    return [CASE]


def evidence_for(case: dict) -> dict[Action, dict[str, Any]]:
    return {
        "ask": {key: value for key, value in case["patient"].items() if key != "Demographics"},
        "exam": case["examination"],
        "test": case["tests"],
    }


def label_for(key: str) -> str:
    return LABELS.get(key, key.replace("_", " "))


def _words(value: str) -> str:
    return " ".join(re.findall(r"\w+", value.casefold()))


def assert_holdout(platform: Platform, session: Session, source: m.Task, case: dict) -> None:
    rows = training_records(platform, source_sites(session, source.id))
    if not rows:
        raise ServiceError(409, "缺少冻结的来源记录，无法核验留出病例")
    fingerprint = case_fingerprint(case)
    history = _words(case["patient"].get("History", ""))
    for row in rows:
        provenance = row.get("provenance") or {}
        source_hash, index = provenance.get("sourceHash"), provenance.get("sourceIndex")
        if not isinstance(source_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", source_hash) or type(index) is not int or index < 0:
            raise ServiceError(409, "生成记录缺少公开病例来源，无法核验留出病例")
        record = row["input"]
        patient = record.get("patient")
        other_history = _words(str(patient.get("History", ""))) if isinstance(patient, dict) else ""
        if (
            (source_hash, index) == (SOURCE_SHA256, SOURCE_INDEX)
            or str(row["id"]).strip().casefold() == str(case["id"]).casefold()
            or case_fingerprint(record) == fingerprint
            or (history and other_history and SequenceMatcher(None, history, other_history).ratio() >= 0.92)
        ):
            raise ServiceError(422, "此病例与经验包的生成记录重合，请选择其他经验包")


def safe_evidence(case: dict) -> dict:
    evidence = evidence_for(case)
    for alias in (case["answer"], REFERENCE_LABEL):
        phrase = r"\s+".join(map(re.escape, alias.split()))
        evidence = redact_reference(evidence, re.compile(phrase, re.IGNORECASE))
    return evidence
