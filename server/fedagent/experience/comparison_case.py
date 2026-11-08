"""读取固定公开病例档案并构造问诊可见资料。"""
import hashlib
import json
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from fedagent_evomed.medical import normalize_case

from ..errors import ServiceError
from ..platform import Platform
from ..schemas.consultation_comparison import Action, ComparisonCase

SOURCE_NAME = "medqa_extended_v1.jsonl"
SOURCE_SHA256 = "54a024eb2705c6c55d1988766adf4ab02ea7bbe2a28f843107b740032200f232"

# 沿用已发布的中文开场和诊断名称。
DISPLAY = {
    141: (
        "9 岁男孩多尿、嗜盐",
        "9 岁男孩由母亲带来就诊。几个月来常觉得乏力，尿量和饮水量增多，还常想吃咸的食物。",
        "Bartter 综合征",
    ),
    138: ("28 岁男子头晕、心悸", "我 28 岁，这两天经常头晕，感觉心跳得很不舒服。", "阵发性心房颤动"),
    143: (
        "65 岁男子肩臂僵硬",
        "我 65 岁，这几个月肩膀和胳膊发僵，梳头和拿高处的东西都比以前费劲。",
        "肩关节粘连性关节囊炎",
    ),
}


@dataclass(frozen=True)
class HeldoutCase:
    summary: ComparisonCase
    source_index: int
    record: dict[str, Any]
    reference_label: str


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



def label_for(key: str) -> str:
    return LABELS.get(key, key.replace("_", " "))


def _reference_pattern(*references: str) -> re.Pattern[str]:
    aliases = set(references)
    for reference in references:
        name, _, _ = reference.partition("(")
        if name.strip() != reference:
            aliases.add(name.strip())
        aliases.update(re.findall(r"\(([A-Z][A-Z0-9]{1,7})\)", reference))
    phrases = [r"[\W_]+".join(map(re.escape, words)) for alias in aliases if (words := re.findall(r"\w+", alias))]
    if not phrases:
        return re.compile(r"(?!)")
    return re.compile(r"(?<![^\W_])(?:" + "|".join(sorted(phrases, key=lambda part: (-len(part), part))) + r")(?![^\W_])",
                      re.IGNORECASE)


def _mask(value: Any, pattern: re.Pattern[str]) -> Any:
    if isinstance(value, dict):
        result = {}
        for key, child in value.items():
            masked = _mask(key, pattern)
            distinct = masked
            # 两个原始项目被遮掉后仍需有独立的可请求编号。
            ordinal = 2
            while distinct in result:
                distinct = f"{masked} ({ordinal})"
                ordinal += 1
            result[distinct] = _mask(child, pattern)
        return result
    if isinstance(value, list):
        return [_mask(child, pattern) for child in value]
    return pattern.sub("[redacted]", value) if isinstance(value, str) else value


def safe_evidence(case: HeldoutCase) -> dict[Action, dict[str, Any]]:
    record = case.record
    return _mask({
        "ask": {key: value for key, value in record["patient"].items() if key != "Demographics"},
        "exam": record["examination"],
        "test": record["tests"],
    }, _reference_pattern(record["answer"], case.reference_label))


def _summary(index: int, record: dict[str, Any]) -> HeldoutCase:
    line = index + 1
    reference = record["answer"]
    if line in DISPLAY:
        title, opening, reference = DISPLAY[line]
    else:
        patient = record["patient"]
        symptoms = patient.get("Symptoms") or {}
        symptom = symptoms.get("Primary_Symptom") if isinstance(symptoms, dict) else None
        history = str(patient.get("History") or "")
        chief = symptom or re.split(r"(?<=[.!?])\s+", history, maxsplit=1)[0]
        pattern = _reference_pattern(reference)
        facts = [str(value) for value in (patient.get("Demographics"), chief) if value]
        opening = _mask(" · ".join(facts), pattern).strip()
        title = f"病例 {line:03d} · {opening[:100]}" if opening else f"病例 {line:03d}"
    pattern = _reference_pattern(record["answer"], reference)
    summary = ComparisonCase(id=f"medqa-ext-{line}", title=_mask(title, pattern), opening=_mask(opening, pattern))
    return HeldoutCase(summary, index, record, reference)


@lru_cache(maxsize=2)
def _parse_catalog(raw: bytes, expected_hash: str) -> dict[str, HeldoutCase]:
    if hashlib.sha256(raw).hexdigest() != expected_hash:
        raise ServiceError(409, "公开病例原档校验失败")
    result = {}
    for index, line in enumerate(raw.splitlines()):
        try:
            row = normalize_case(json.loads(line), fallback_id=f"medqa-ext-{index + 1}")
            if not row.get("answer") or any(not isinstance(row[key], dict) for key in ("patient", "examination", "tests")):
                continue
            case = _summary(index, row)
            if case.summary.opening:
                result[case.summary.id] = case
        except ValueError:
            continue
    return result


def load_catalog(platform: Platform) -> dict[str, HeldoutCase]:
    path = platform.settings.data_dir / "consultation-cases" / SOURCE_NAME
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise ServiceError(409, "公开病例原档未安装或不可读取") from error
    return _parse_catalog(raw, SOURCE_SHA256)
