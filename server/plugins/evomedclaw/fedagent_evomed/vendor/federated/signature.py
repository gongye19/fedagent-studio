"""Stable semantic signatures for federated card aggregation."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Iterable, List, Optional

from fedagent_evomed.vendor.learning.card_types import ProcessCard


_SPACE_RE = re.compile(r"\s+")


def normalize_term(value: str | None) -> str:
    text = _SPACE_RE.sub(" ", str(value or "").strip().lower())
    return text


def normalize_terms(values: Iterable[str] | None) -> List[str]:
    return sorted({term for term in (normalize_term(value) for value in (values or [])) if term})


def build_signature_payload(
    *,
    memory_type: str,
    stage: str,
    owner_role: str,
    department: str,
    positive_triggers: Iterable[str] | None,
    negative_triggers: Iterable[str] | None,
    target_action: str | None,
    target_diagnosis_shift: str | None,
) -> dict:
    return {
        "memory_type": normalize_term(memory_type),
        "stage": normalize_term(stage),
        "owner_role": normalize_term(owner_role),
        "department": normalize_term(department),
        "positive_triggers": normalize_terms(positive_triggers),
        "negative_triggers": normalize_terms(negative_triggers),
        "target_action": normalize_term(target_action),
        "target_diagnosis_shift": normalize_term(target_diagnosis_shift),
    }


def build_card_signature_from_fields(
    *,
    memory_type: str,
    stage: str,
    owner_role: str,
    department: str,
    positive_triggers: Iterable[str] | None,
    negative_triggers: Iterable[str] | None,
    target_action: Optional[str],
    target_diagnosis_shift: Optional[str],
) -> str:
    payload = build_signature_payload(
        memory_type=memory_type,
        stage=stage,
        owner_role=owner_role,
        department=department,
        positive_triggers=positive_triggers,
        negative_triggers=negative_triggers,
        target_action=target_action,
        target_diagnosis_shift=target_diagnosis_shift,
    )
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def build_card_signature(card: ProcessCard) -> str:
    return build_card_signature_from_fields(
        memory_type=card.memory_type,
        stage=card.stage,
        owner_role=card.owner_role,
        department=card.department,
        positive_triggers=card.positive_triggers,
        negative_triggers=card.negative_triggers,
        target_action=card.target_action,
        target_diagnosis_shift=card.target_diagnosis_shift,
    )
