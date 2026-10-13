"""Core retrieval helpers owned by the EvoMed runtime."""

from __future__ import annotations

import hashlib
import re
from collections import Counter
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence


DEFAULT_MEMORY_TOP_K = 4

DEPARTMENT_KEYWORDS = {
    "emergency": {"acute", "unstable", "shock", "sepsis", "syncope", "trauma", "altered", "bleeding"},
    "cardiology": {"chest", "angina", "palpitations", "troponin", "ecg", "heart", "arrhythmia", "orthopnea"},
    "pulmonology": {"cough", "wheeze", "dyspnea", "shortness", "hemoptysis", "asthma", "pneumonia", "respiratory"},
    "neurology": {"weakness", "diplopia", "ptosis", "headache", "seizure", "focal", "stroke", "neuromuscular"},
    "gastro_hepatology": {"abdominal", "jaundice", "bilirubin", "ascites", "liver", "vomiting", "diarrhea", "bowel"},
    "nephrology_urology": {"renal", "kidney", "creatinine", "hematuria", "proteinuria", "flank", "urinary", "dysuria"},
    "endocrinology": {"thyroid", "glucose", "diabetes", "polyuria", "polydipsia", "cortisol", "amenorrhea", "metabolic"},
    "hematology_oncology": {"anemia", "leukocytosis", "lymphoma", "leukemia", "thrombocytopenia", "mass", "malignancy", "blast"},
    "infectious_disease": {"fever", "chills", "infection", "viral", "bacterial", "antibiotic", "septic", "culture"},
    "rheumatology": {"arthritis", "arthralgia", "autoimmune", "vasculitis", "lupus", "myalgia", "inflammatory", "joint"},
    "dermatology": {"rash", "lesion", "vesicle", "pruritus", "melanoma", "skin", "papule", "plaque"},
    "obgyn": {"pregnant", "pregnancy", "vaginal", "uterine", "placenta", "fetal", "amenorrhea", "pelvic"},
    "pediatrics": {"newborn", "infant", "child", "pediatric", "meconium", "neonate", "feeding", "bilious"},
    "surgery_orthopedics": {"fracture", "dislocation", "surgical", "appendicitis", "obstruction", "ligament", "avulsion", "orthopedic"},
}

DEPARTMENT_NEIGHBORS = {
    "cardiology": {"pulmonology", "emergency"},
    "pulmonology": {"cardiology", "infectious_disease", "emergency"},
    "neurology": {"emergency", "surgery_orthopedics"},
    "gastro_hepatology": {"infectious_disease", "obgyn", "surgery_orthopedics"},
    "obgyn": {"emergency", "pediatrics"},
}

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "before", "but", "by", "can",
    "could", "did", "do", "does", "for", "from", "had", "has", "have", "if", "in",
    "into", "is", "it", "its", "may", "more", "most", "no", "not", "of", "on", "or",
    "so", "that", "the", "their", "there", "these", "they", "this", "to", "was", "were",
    "what", "when", "which", "with", "would", "you", "your", "doctor", "patient", "hospital",
    "expert", "opinion", "assessment", "differential", "diagnosis", "consultation",
    "history", "summary", "results", "current", "performed",
}


@dataclass
class DepartmentTag:
    name: str
    score: float
    evidence: List[str] = field(default_factory=list)


@dataclass
class SanitizedState:
    scenario_id: int
    owner_role: str
    stage: str
    department_tags: List[DepartmentTag]
    chief_complaint: str
    positives: List[str]
    negatives: List[str]
    tests_done: List[str]
    working_differential: List[str]
    question_count: int
    has_hospital_opinion: bool
    uncertainty: float
    summary_text: str
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SkillRecord:
    skill_id: str
    owner_role: str
    stage: str
    department: str
    skill_type: str
    trigger_text: str
    trigger_keywords: List[str]
    action_template: str
    rationale: str
    support_count: int
    success_count: int
    failure_count: int
    transfer_score: float
    negative_constraints: List[str]
    source_case_ids: List[int]
    enabled: bool = True
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ExperienceRecord:
    experience_id: str
    owner_role: str
    department: str
    stage: str
    summary_text: str
    action_taken: str
    outcome_label: str
    useful_tests: List[str]
    source_case_id: int
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class FailureHint:
    hint_id: str
    owner_role: str
    department: str
    stage: str
    trigger_keywords: List[str]
    prohibition: str
    missed_action: str
    source_case_id: int
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RetrievedItem:
    score: float
    item_type: str
    payload: Dict[str, Any]


def tokenize(text: str) -> List[str]:
    """Tokenize free text for matching."""
    if not text:
        return []
    words = re.findall(r"[a-z][a-z0-9\-]{2,}", text.lower())
    return [word for word in words if word not in STOPWORDS]


def top_keywords(text: str, limit: int = 12) -> List[str]:
    """Return the most common informative tokens."""
    counts = Counter(tokenize(text))
    return [word for word, _ in counts.most_common(limit)]


def jaccard_overlap(a: Sequence[str], b: Sequence[str]) -> float:
    """Compute Jaccard overlap between token sequences."""
    set_a = set(a)
    set_b = set(b)
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / len(set_a | set_b)


def stable_digest(*parts: str, size: int = 10) -> str:
    """Build a short stable digest."""
    joined = "::".join(part.strip().lower() for part in parts if part)
    return hashlib.sha1(joined.encode("utf-8")).hexdigest()[:size]


def normalize_action(text: str) -> str:
    """Normalize action text for grouping."""
    return re.sub(r"\s+", " ", (text or "").strip()).lower()


def infer_department_tags(text: str, top_k: int = 2) -> List[DepartmentTag]:
    """Infer top departments using deterministic keyword scoring."""
    counts = Counter(tokenize(text))
    tags: List[DepartmentTag] = []
    for department, keywords in DEPARTMENT_KEYWORDS.items():
        shared = [token for token in counts if token in keywords]
        if not shared:
            continue
        score = round(sum(counts[token] for token in shared) / max(sum(counts.values()), 1), 4)
        tags.append(DepartmentTag(name=department, score=score, evidence=sorted(shared)[:4]))
    if not tags:
        tags.append(DepartmentTag(name="emergency", score=0.0, evidence=[]))
    tags.sort(key=lambda item: item.score, reverse=True)
    return tags[:top_k]


def extract_keyed_section(text: str, label: str) -> str:
    match = re.search(rf"{re.escape(label)}\s*:\s*(.+)", text, flags=re.IGNORECASE)
    return match.group(1).strip() if match else ""


def extract_list_section(text: str, label: str) -> List[str]:
    block = extract_keyed_section(text, label)
    if not block:
        return []
    return [
        part.strip(" -*")
        for part in re.split(r"[;,]|\n|\*", block)
        if part.strip(" -*")
    ]


def build_runtime_state(
    scenario_id: int,
    owner_role: str,
    dialogue_text: str,
    question_count: int,
    tests_done: Sequence[str],
    has_hospital_opinion: bool,
    uncertainty: float,
    stage: str,
    working_differential: Optional[Sequence[str]] = None,
) -> SanitizedState:
    """Build a runtime retrieval state."""
    tags = infer_department_tags(dialogue_text)
    chief_complaint = dialogue_text.splitlines()[0][:180] if dialogue_text else ""
    return SanitizedState(
        scenario_id=scenario_id,
        owner_role=owner_role,
        stage=stage,
        department_tags=tags,
        chief_complaint=chief_complaint,
        positives=top_keywords(dialogue_text, limit=8),
        negatives=[],
        tests_done=list(tests_done),
        working_differential=list(working_differential or []),
        question_count=question_count,
        has_hospital_opinion=has_hospital_opinion,
        uncertainty=max(0.0, min(1.0, uncertainty)),
        summary_text=dialogue_text,
    )


def build_sanitized_state_from_summary(
    scenario_id: int,
    owner_role: str,
    stage: str,
    summary_text: str,
    question_count: int = 0,
    tests_done: Optional[Sequence[str]] = None,
    has_hospital_opinion: bool = False,
    working_differential: Optional[Sequence[str]] = None,
    uncertainty: float = 0.5,
) -> SanitizedState:
    """Build a state from a structured summary."""
    tags = infer_department_tags(summary_text)
    chief_complaint = extract_keyed_section(summary_text, "Chief Complaint") or summary_text[:180]
    positives = extract_list_section(summary_text, "Key Positive Findings") or top_keywords(summary_text, limit=8)
    negatives = extract_list_section(summary_text, "Key Negative Findings")
    tests = list(tests_done or extract_list_section(summary_text, "Tests Performed"))
    differential = list(working_differential or extract_list_section(summary_text, "Working Differential"))
    return SanitizedState(
        scenario_id=scenario_id,
        owner_role=owner_role,
        stage=stage,
        department_tags=tags,
        chief_complaint=chief_complaint,
        positives=positives,
        negatives=negatives,
        tests_done=tests,
        working_differential=differential,
        question_count=question_count,
        has_hospital_opinion=has_hospital_opinion,
        uncertainty=max(0.0, min(1.0, uncertainty)),
        summary_text=summary_text,
    )


def build_experience(
    state: SanitizedState,
    action_text: str,
    outcome_label: str,
    useful_tests: Optional[Sequence[str]] = None,
    metadata: Optional[Mapping[str, Any]] = None,
) -> ExperienceRecord:
    """Build an experience record from a state-action pair."""
    department = state.department_tags[0].name if state.department_tags else "emergency"
    experience_id = stable_digest(
        str(state.scenario_id),
        state.owner_role,
        state.stage,
        department,
        normalize_action(action_text),
    )
    payload = {"trigger_keywords": top_keywords(state.summary_text, limit=10)}
    payload.update(dict(metadata or {}))
    return ExperienceRecord(
        experience_id=f"exp_{experience_id}",
        owner_role=state.owner_role,
        department=department,
        stage=state.stage,
        summary_text=state.summary_text[:500],
        action_taken=action_text.strip(),
        outcome_label=outcome_label,
        useful_tests=list(useful_tests or []),
        source_case_id=state.scenario_id,
        metadata=payload,
    )


def infer_skill_type(action_text: str, owner_role: str, stage: str) -> str:
    upper = action_text.upper()
    if owner_role == "HospitalAgent":
        if "RECOMMENDED TEST" in upper:
            return "recommended_test"
        if "RED FLAGS" in upper:
            return "red_flag_exclusion"
        if "AGREE" in upper or "DISAGREE" in upper:
            return "disagreement_resolution"
        return "differential_rerank"
    if "REQUEST TEST" in upper:
        return "test_ordering"
    if "REQUEST CONSULTATION" in upper:
        return "consult_trigger"
    if "DIAGNOSIS READY" in upper:
        return "forced_diagnosis"
    if stage == "post_consult":
        return "post_consult_verification"
    return "questioning"


def build_candidate_skill(
    state: SanitizedState,
    action_text: str,
    is_correct: bool,
    negative_constraints: Optional[Sequence[str]] = None,
) -> SkillRecord:
    """Build a candidate skill."""
    department = state.department_tags[0].name if state.department_tags else "emergency"
    skill_type = infer_skill_type(action_text, state.owner_role, state.stage)
    trigger_keywords = top_keywords(
        " ".join([state.chief_complaint] + state.positives + state.working_differential),
        limit=10,
    )
    skill_id = stable_digest(
        state.owner_role,
        state.stage,
        department,
        skill_type,
        normalize_action(action_text),
    )
    return SkillRecord(
        skill_id=f"skill_{skill_id}",
        owner_role=state.owner_role,
        stage=state.stage,
        department=department,
        skill_type=skill_type,
        trigger_text=", ".join(trigger_keywords[:5]),
        trigger_keywords=trigger_keywords,
        action_template=action_text.strip(),
        rationale="Auto-mined from de-identified clinical trajectories.",
        support_count=1,
        success_count=1 if is_correct else 0,
        failure_count=0 if is_correct else 1,
        transfer_score=1.0 if is_correct else 0.0,
        negative_constraints=list(negative_constraints or []),
        source_case_ids=[state.scenario_id],
        enabled=is_correct,
        metadata={
            "applies_to_departments": [department],
            "department_tags": [asdict(tag) for tag in state.department_tags],
            "scope": "canonical",
        },
    )


def metadata_scope(payload: SkillRecord | Mapping[str, Any]) -> str:
    metadata = payload.metadata if isinstance(payload, SkillRecord) else payload.get("metadata", {})
    return str(metadata.get("scope", "canonical"))


def applicable_departments(payload: SkillRecord | Mapping[str, Any], expand_neighbors: bool = False) -> set[str]:
    if isinstance(payload, SkillRecord):
        metadata = payload.metadata
        department = payload.department
    else:
        metadata = payload.get("metadata", {})
        department = payload.get("department", "emergency")
    departments = set(metadata.get("applies_to_departments", [])) or {str(department)}
    if not expand_neighbors:
        return departments
    expanded = set(departments)
    for item in list(departments):
        expanded.update(DEPARTMENT_NEIGHBORS.get(item, set()))
    return expanded


def retrieve_memory_items(
    memory_bank: Dict[str, Any],
    state: SanitizedState,
    top_k: int = DEFAULT_MEMORY_TOP_K,
) -> List[RetrievedItem]:
    """Retrieve the most relevant skills and failure hints."""
    results: List[RetrievedItem] = []
    state_keywords = top_keywords(state.summary_text, limit=12)
    primary_departments = {tag.name for tag in state.department_tags[:2]}
    neighbor_departments: set[str] = set()
    for department in primary_departments:
        neighbor_departments.update(DEPARTMENT_NEIGHBORS.get(department, set()))

    for skill in memory_bank.get("skills", []):
        if not skill.get("enabled", True):
            continue
        if skill["owner_role"] != state.owner_role or skill["stage"] != state.stage:
            continue
        departments = applicable_departments(skill)
        department_bonus = 0.0
        if departments & primary_departments:
            department_bonus = 0.25
        elif departments & neighbor_departments:
            department_bonus = 0.10
        overlap = jaccard_overlap(state_keywords, skill.get("trigger_keywords", []))
        if overlap <= 0.0 and department_bonus <= 0.0:
            continue
        score = 0.35 * overlap
        score += department_bonus
        score += 0.15 * min(state.question_count / 6.0, 1.0)
        score += 0.15 * float(skill.get("transfer_score", 0.0))
        score += 0.10 * float(skill.get("metadata", {}).get("success_rate", 0.0))
        scope = metadata_scope(skill)
        if scope == "specialized":
            score += 0.06
        elif scope == "generalized":
            score += 0.04
        elif scope == "composed" and state.uncertainty >= 0.6:
            score += 0.05
        if state.has_hospital_opinion and state.stage == "post_consult":
            score += 0.05
        if state.uncertainty >= 0.6 and skill["skill_type"] in {"test_ordering", "consult_trigger", "action_chain"}:
            score += 0.05
        results.append(RetrievedItem(score=round(score, 4), item_type="skill", payload=skill))

    for hint in memory_bank.get("failure_hints", []):
        if hint["owner_role"] != state.owner_role or hint["stage"] != state.stage:
            continue
        overlap = jaccard_overlap(state_keywords, hint.get("trigger_keywords", []))
        if overlap < 0.15:
            continue
        score = 0.30 * overlap
        if hint["department"] in primary_departments:
            score += 0.25
        results.append(RetrievedItem(score=round(score, 4), item_type="failure_hint", payload=hint))

    results.sort(key=lambda item: item.score, reverse=True)
    return results[:top_k]


__all__ = [
    "DepartmentTag",
    "ExperienceRecord",
    "FailureHint",
    "RetrievedItem",
    "SanitizedState",
    "SkillRecord",
    "build_candidate_skill",
    "build_experience",
    "build_runtime_state",
    "build_sanitized_state_from_summary",
    "infer_department_tags",
    "jaccard_overlap",
    "normalize_action",
    "retrieve_memory_items",
    "stable_digest",
    "tokenize",
    "top_keywords",
]
