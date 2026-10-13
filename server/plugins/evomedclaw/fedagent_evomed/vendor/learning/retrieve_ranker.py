"""Deterministic offline retrieval scoring for process cards."""

from __future__ import annotations

import re
from typing import Iterable, List

from fedagent_evomed.vendor.learning.card_types import ProcessCard
from fedagent_evomed.vendor.learning.types import CanonicalStep, RetrievalHit

_STOPWORDS = {
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
}


def normalize_text(text: str | None) -> str:
    """Normalize free text for exact phrase matching."""
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def tokenize_text(text: str | None) -> List[str]:
    """Tokenize informative terms for trace display."""
    tokens = re.findall(r"[a-zA-Z_]+", normalize_text(text))
    return [token for token in tokens if token not in _STOPWORDS]


def _normalize_list(values: Iterable[str]) -> List[str]:
    return [normalize_text(value) for value in values if normalize_text(value)]


def step_department(step: CanonicalStep) -> str:
    """Infer the active department for one canonical step."""
    primary = step.route_decision.get("primary_department")
    return str(primary or "general_internal_medicine")


def score_card_for_step(card: ProcessCard, step: CanonicalStep) -> RetrievalHit | None:
    """Return a ranked hit when the card is compatible with the step context."""
    if card.stage != step.stage:
        return None
    if card.owner_role != step.role:
        return None

    department = step_department(step)
    if card.department not in {department, "general_internal_medicine"}:
        return None

    step_positives = set(_normalize_list(step.positives))
    step_negatives = set(_normalize_list(step.negatives))
    card_positives = set(_normalize_list(card.positive_triggers))
    card_negatives = set(_normalize_list(card.negative_triggers))
    matched_phrases = sorted((step_positives & card_positives) | (step_negatives & card_negatives))

    score = 0.0
    if matched_phrases:
        score += len(matched_phrases) * 1.5

    observed_payload = normalize_text(step.action_payload)
    test_candidates = set(_normalize_list(step.tests + ([step.action_payload] if step.action_payload else [])))
    if card.target_action and normalize_text(card.target_action) in test_candidates:
        score += 2.0
        matched_phrases.append(normalize_text(card.target_action))

    if card.target_diagnosis_shift and normalize_text(card.target_diagnosis_shift) == observed_payload:
        score += 2.0
        matched_phrases.append(normalize_text(card.target_diagnosis_shift))

    if card.department == department:
        score += 0.5
    elif card.department == "general_internal_medicine":
        score += 0.25

    unique_terms = sorted({term for term in matched_phrases if term})
    if score <= 0.5:
        return None
    return RetrievalHit(
        entry_id=card.entry_id,
        score=round(score, 4),
        matched_terms=unique_terms,
    )
