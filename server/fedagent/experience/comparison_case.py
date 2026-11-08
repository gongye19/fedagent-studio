"""读取已登记的公开留出病例，由服务端按动作返回已有资料。"""
import hashlib
import json
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from fedagent_evomed.medical import normalize_case
from sqlalchemy.orm import Session

from .. import models as m
from ..errors import ServiceError
from ..platform import Platform
from ..schemas.consultation_comparison import Action, ComparisonCase
from .cases import case_fingerprint, redact_reference, source_sites, training_records

SOURCE_SHA256 = "54a024eb2705c6c55d1988766adf4ab02ea7bbe2a28f843107b740032200f232"


@dataclass(frozen=True)
class HeldoutCase:
    summary: ComparisonCase
    file_sha256: str
    source_index: int
    reference_label: str


CASES = {
    "medqa-ext-141": HeldoutCase(
        summary=ComparisonCase(
            id="medqa-ext-141", title="9 岁男孩多尿、嗜盐",
            opening="9 岁男孩由母亲带来就诊。几个月来常觉得乏力，尿量和饮水量增多，还常想吃咸的食物。",
        ),
        file_sha256="24d0895867bdb336c511e587cd4b3ef88974f17b3eb9eae3edc30a12f69769c7",
        source_index=140, reference_label="Bartter 综合征",
    ),
    "medqa-ext-138": HeldoutCase(
        summary=ComparisonCase(
            id="medqa-ext-138", title="28 岁男子头晕、心悸",
            opening="我 28 岁，这两天经常头晕，感觉心跳得很不舒服。",
        ),
        file_sha256="0f037b747eb43491a71d71956a67442fe93b3673be49d21e3d9f025dee52bb41",
        source_index=137, reference_label="阵发性心房颤动",
    ),
    "medqa-ext-143": HeldoutCase(
        summary=ComparisonCase(
            id="medqa-ext-143", title="65 岁男子肩臂僵硬",
            opening="我 65 岁，这几个月肩膀和胳膊发僵，梳头和拿高处的东西都比以前费劲。",
        ),
        file_sha256="a42ef1fc0ebe70c34fdd99a5ee9329af1c8a2e9529edfa4e9f41ce7f19c1f2b0",
        source_index=142, reference_label="肩关节粘连性关节囊炎",
    ),
}

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
    "Temperature": "体温", "Heart_Rate": "心率", "ECG": "心电图", "Blood_Tests": "血液检查",
    "Cardiovascular_Examination": "心血管查体", "Respiratory_Examination": "呼吸系统查体",
    "Neurological_Examination": "神经系统查体", "Shoulder_Examination": "肩关节查体",
    "Inspection": "视诊", "Palpation": "触诊", "Auscultation": "听诊", "Percussion": "叩诊",
    "Range_of_Motion": "活动范围", "Strength_Testing": "肌力检查", "Imaging": "影像检查",
    "X-ray_Shoulder": "肩关节 X 光", "Findings": "所见", "CBC": "血常规",
    "Electrolytes": "电解质", "Glucose": "血糖", "Thyroid_Function_Tests": "甲状腺功能",
    "Alcohol_Level": "酒精浓度",
}


def get_case(case_id: str) -> HeldoutCase:
    definition = CASES.get(case_id)
    if definition is None:
        raise ServiceError(404, "留出病例不存在")
    return definition


def load_case(platform: Platform, definition: HeldoutCase) -> dict:
    case_id = definition.summary.id
    try:
        raw = (platform.settings.data_dir / "consultation-cases" / f"{case_id}.json").read_bytes()
        if hashlib.sha256(raw).hexdigest() != definition.file_sha256:
            raise ValueError("病例内容与公开版本不一致")
        case = normalize_case(json.loads(raw), fallback_id=case_id)
        if not case.get("answer") or any(not isinstance(case[key], dict) for key in ("patient", "examination", "tests")):
            raise ValueError("病例缺少结构化资料或参考诊断")
        return case
    except (OSError, ValueError) as error:
        raise ServiceError(409, "留出病例原档未安装或校验失败") from error


def available_cases(platform: Platform) -> list[ComparisonCase]:
    result = []
    for definition in CASES.values():
        try:
            load_case(platform, definition)
        except ServiceError:
            continue
        result.append(definition.summary)
    return result


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


def assert_holdout(platform: Platform, session: Session, source: m.Task, definition: HeldoutCase, case: dict) -> None:
    rows = training_records(platform, source_sites(session, source.id))
    if not rows:
        raise ServiceError(409, "缺少冻结的来源记录，无法核验留出病例")
    fingerprint = case_fingerprint(case)
    history = _words(str(case["patient"].get("History", "")))
    for row in rows:
        provenance = row.get("provenance") or {}
        source_hash, index = provenance.get("sourceHash"), provenance.get("sourceIndex")
        if not isinstance(source_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", source_hash) or type(index) is not int or index < 0:
            raise ServiceError(409, "生成记录缺少公开病例来源，无法核验留出病例")
        record = row["input"]
        patient = record.get("patient")
        other_history = _words(str(patient.get("History", ""))) if isinstance(patient, dict) else ""
        if (
            (source_hash, index) == (SOURCE_SHA256, definition.source_index)
            or str(row["id"]).strip().casefold() == str(case["id"]).casefold()
            or case_fingerprint(record) == fingerprint
            or (history and other_history and SequenceMatcher(None, history, other_history).ratio() >= 0.92)
        ):
            raise ServiceError(422, "此病例与经验包的生成记录重合，请选择其他经验包")


def safe_evidence(case: dict, reference_label: str) -> dict:
    evidence = evidence_for(case)
    for alias in (case["answer"], reference_label):
        phrase = r"\s+".join(map(re.escape, alias.split()))
        evidence = redact_reference(evidence, re.compile(phrase, re.IGNORECASE))
    return evidence
