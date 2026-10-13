"""Export process cards into the legacy department-memory format."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List

from fedagent_evomed.vendor.learning.card_bank import CardBank
from fedagent_evomed.vendor.learning.card_types import ProcessCard
from fedagent_evomed.vendor.runtime.department_first.core.types import MemoryEntry

_DATA_DIR = Path(__file__).resolve().parent / "data"
_DEFAULT_CONFIG: Dict[str, Any] = {
    "summary_trigger_limit": 2,
    "required_evidence_limit": 8,
    "contraindication_limit": 8,
    "stopwords": [
        "a",
        "an",
        "and",
        "for",
        "in",
        "of",
        "or",
        "the",
        "to",
        "with",
    ],
    "negation_tokens": [
        "absent",
        "denied",
        "denies",
        "negative",
        "no",
        "not",
        "without",
    ],
}


def _load_export_config(config_path: str | Path | None = None) -> Dict[str, Any]:
    path = Path(config_path) if config_path else _DATA_DIR / "legacy_bank_export_config.json"
    if not path.exists():
        return dict(_DEFAULT_CONFIG)

    payload = json.loads(path.read_text(encoding="utf-8"))
    config = dict(_DEFAULT_CONFIG)
    if isinstance(payload, dict):
        config.update(payload)
    return config


def _iter_cards(card_bank_or_cards: CardBank | Iterable[ProcessCard]) -> List[ProcessCard]:
    if isinstance(card_bank_or_cards, CardBank):
        return list(card_bank_or_cards.cards)
    return list(card_bank_or_cards)


def _tokenize(text: str) -> List[str]:
    return re.findall(r"[a-zA-Z_]+", (text or "").lower())


def _flatten_trigger_tokens(
    triggers: Iterable[str],
    *,
    limit: int,
    stopwords: set[str],
    negation_tokens: set[str],
) -> List[str]:
    items: List[str] = []
    seen: set[str] = set()
    for trigger in triggers:
        for token in _tokenize(trigger):
            if token in stopwords or token in negation_tokens or token in seen:
                continue
            seen.add(token)
            items.append(token)
            if len(items) >= limit:
                return items
    return items


def _trigger_excerpt(card: ProcessCard, limit: int) -> str:
    triggers = list(card.positive_triggers[:limit])
    if triggers:
        return "; ".join(triggers)
    if card.target_action:
        return card.target_action
    if card.target_diagnosis_shift:
        return card.target_diagnosis_shift
    return "the matched evidence state"


def _build_summary(card: ProcessCard, *, trigger_limit: int) -> str:
    excerpt = _trigger_excerpt(card, trigger_limit)
    if card.memory_type == "test_card":
        return f"Evidence-build rule favoring {card.target_action} for {excerpt}."
    if card.memory_type == "route_card":
        return f"Routing rule toward {card.target_action} for {excerpt}."
    if card.memory_type == "clue_card":
        return f"Specialist clue pattern supporting {card.target_diagnosis_shift}."
    if card.memory_type == "synthesis_card":
        return f"Post-consult synthesis rule supporting {card.target_diagnosis_shift}."
    if card.memory_type == "error_card":
        return f"Defensive rule to avoid missing {card.target_diagnosis_shift}."
    return f"Process rule for {excerpt}."


def _build_guidance(card: ProcessCard, *, trigger_limit: int) -> str:
    excerpt = _trigger_excerpt(card, trigger_limit)
    rationale = card.minimal_rationale.strip()

    if card.memory_type == "test_card":
        guidance = f"When {excerpt} recur, prioritize {card.target_action}."
    elif card.memory_type == "route_card":
        guidance = f"When {excerpt} define the consult state, route first to {card.target_action}."
    elif card.memory_type == "clue_card":
        guidance = f"When this specialist-style clue pattern appears, shift the differential toward {card.target_diagnosis_shift}."
    elif card.memory_type == "synthesis_card":
        guidance = f"After consultation, synthesize toward {card.target_diagnosis_shift} when {excerpt} remain the dominant evidence."
    elif card.memory_type == "error_card":
        guidance = f"Avoid locking in the observed wrong resolution; reopen {card.target_diagnosis_shift} before finalizing when {excerpt} recur."
    else:
        guidance = f"Apply this rule when {excerpt} recur."

    if rationale:
        guidance = f"{guidance} {rationale}"
    return guidance


def _heldout_success_rate(card: ProcessCard) -> float:
    score = card.verifier_score + card.heldout_lift - card.false_trigger_rate
    return max(0.0, min(1.0, score))


def card_to_legacy_entry(
    card: ProcessCard,
    *,
    config_path: str | Path | None = None,
) -> Dict[str, Any]:
    """Convert one process card into the runtime-compatible MemoryEntry shape."""
    config = _load_export_config(config_path)
    stopwords = set(config["stopwords"])
    negation_tokens = set(config["negation_tokens"])
    required_limit = int(config["required_evidence_limit"])
    contraindication_limit = int(config["contraindication_limit"])
    trigger_limit = int(config["summary_trigger_limit"])

    required_evidence = _flatten_trigger_tokens(
        card.positive_triggers,
        limit=required_limit,
        stopwords=stopwords,
        negation_tokens=set(),
    )
    if not required_evidence:
        fallback = card.target_action or card.target_diagnosis_shift or card.stage
        required_evidence = _flatten_trigger_tokens(
            [fallback],
            limit=required_limit,
            stopwords=stopwords,
            negation_tokens=set(),
        )

    contraindications = _flatten_trigger_tokens(
        card.negative_triggers,
        limit=contraindication_limit,
        stopwords=stopwords,
        negation_tokens=negation_tokens,
    )

    entry = MemoryEntry(
        entry_id=card.entry_id,
        department=card.department,
        owner_role=card.owner_role,
        stage=card.stage,
        summary=_build_summary(card, trigger_limit=trigger_limit),
        guidance=_build_guidance(card, trigger_limit=trigger_limit),
        required_evidence=required_evidence,
        contraindications=contraindications,
        source_cases=list(card.source_cases),
        heldout_success_rate=_heldout_success_rate(card),
    )
    return entry.to_dict()


def build_legacy_bank_payload(
    card_bank_or_cards: CardBank | Iterable[ProcessCard],
    *,
    config_path: str | Path | None = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Build the legacy payload expected by DepartmentMemoryBank.from_path."""
    cards = _iter_cards(card_bank_or_cards)
    entries = [card_to_legacy_entry(card, config_path=config_path) for card in cards]
    return {"entries": entries}


def export_legacy_bank(
    card_bank_or_cards: CardBank | Iterable[ProcessCard],
    output_path: str | Path,
    *,
    config_path: str | Path | None = None,
) -> int:
    """Write a legacy-compatible memory bank JSON file and return entry count."""
    payload = build_legacy_bank_payload(card_bank_or_cards, config_path=config_path)
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return len(payload["entries"])
