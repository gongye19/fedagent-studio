"""Convert local card banks into anonymized federated deltas."""

from __future__ import annotations

import hashlib
import json
from typing import Dict

from fedagent_evomed.vendor.federated.signature import build_card_signature, normalize_terms
from fedagent_evomed.vendor.federated.types import FederatedCardDelta, FederatedSiteDelta
from fedagent_evomed.vendor.learning.card_bank import CardBank
from fedagent_evomed.vendor.learning.skill_attribution import CardAttributionSummary, SkillAttributionReport


def _summary_by_entry_id(report: SkillAttributionReport) -> Dict[str, CardAttributionSummary]:
    return {summary.entry_id: summary for summary in report.card_summaries}


def _bank_digest(site_id: str, card_signatures: list[str]) -> str:
    raw = json.dumps({"site_id": site_id, "card_signatures": sorted(card_signatures)}, sort_keys=True)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def build_federated_site_delta(
    *,
    site_id: str,
    card_bank: CardBank,
    attribution_report: SkillAttributionReport,
    min_support: int = 1,
) -> FederatedSiteDelta:
    """Strip local identifiers and export only abstract skill deltas."""
    by_entry_id = _summary_by_entry_id(attribution_report)
    cards: list[FederatedCardDelta] = []

    for card in card_bank.cards:
        support_count = len(card.source_cases)
        if support_count < min_support:
            continue

        summary = by_entry_id.get(card.entry_id)
        cards.append(
            FederatedCardDelta(
                card_signature=build_card_signature(card),
                memory_type=card.memory_type,
                stage=card.stage,
                owner_role=card.owner_role,
                department=card.department,
                positive_triggers=normalize_terms(card.positive_triggers),
                negative_triggers=normalize_terms(card.negative_triggers),
                target_action=card.target_action,
                target_diagnosis_shift=card.target_diagnosis_shift,
                support_count=support_count,
                helpful_hits=int(summary.helpful_hits if summary else 0),
                harmful_hits=int(summary.harmful_hits if summary else 0),
                missed_opportunities=int(summary.missed_opportunities if summary else 0),
                neutral_hits=int(summary.neutral_hits if summary else 0),
            )
        )

    signatures = [card.card_signature for card in cards]
    return FederatedSiteDelta(
        site_id=site_id,
        cards=cards,
        metadata={
            "privacy_mode": "delta_only",
            "redacted_fields": [
                "entry_id",
                "minimal_rationale",
                "source_cases",
                "per_case_identifiers",
            ],
            "num_local_cards": len(card_bank.cards),
            "num_exported_cards": len(cards),
            "bank_digest": _bank_digest(site_id, signatures),
        },
    )
