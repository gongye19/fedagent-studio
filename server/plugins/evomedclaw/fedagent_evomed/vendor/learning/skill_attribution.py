"""Aggregate retrieval traces into retrieve-aware skill attribution reports."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Iterable, List

from fedagent_evomed.vendor.learning.card_bank import CardBank
from fedagent_evomed.vendor.learning.card_types import ProcessCard
from fedagent_evomed.vendor.learning.types import StepRetrievalTrace


@dataclass
class CardAttributionSummary:
    """Per-card retrieval attribution summary."""

    entry_id: str
    stage: str
    role: str
    department: str
    helpful_hits: int = 0
    harmful_hits: int = 0
    missed_opportunities: int = 0
    neutral_hits: int = 0
    scenario_ids: List[int] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class MissingSkillSummary:
    """Repeated state slice with no supporting card in the current bank."""

    gap_id: str
    stage: str
    role: str
    department: str
    action_type: str
    target_action: str | None
    target_diagnosis_shift: str | None
    occurrence_count: int = 0
    scenario_ids: List[int] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SkillAttributionReport:
    """Full retrieve-aware attribution report."""

    card_summaries: List[CardAttributionSummary] = field(default_factory=list)
    missing_skill_summaries: List[MissingSkillSummary] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "card_summaries": [item.to_dict() for item in self.card_summaries],
            "missing_skill_summaries": [item.to_dict() for item in self.missing_skill_summaries],
        }


def _iter_cards(card_bank_or_cards: CardBank | Iterable[ProcessCard]) -> List[ProcessCard]:
    if isinstance(card_bank_or_cards, CardBank):
        return list(card_bank_or_cards.cards)
    return list(card_bank_or_cards)


def summarize_skill_attribution(
    traces: Iterable[StepRetrievalTrace],
    card_bank_or_cards: CardBank | Iterable[ProcessCard],
) -> SkillAttributionReport:
    """Aggregate helpful / harmful / missed retrieval evidence into summaries."""
    cards = _iter_cards(card_bank_or_cards)
    summaries = {
        card.entry_id: CardAttributionSummary(
            entry_id=card.entry_id,
            stage=card.stage,
            role=card.owner_role,
            department=card.department,
        )
        for card in cards
    }
    gaps: Dict[tuple[str, str, str, str, str], MissingSkillSummary] = {}

    for trace in traces:
        for hit in trace.top_hits:
            summary = summaries[hit.entry_id]
            if trace.scenario_id not in summary.scenario_ids:
                summary.scenario_ids.append(trace.scenario_id)
            if hit.attribution_label == "helpful_hit":
                summary.helpful_hits += 1
            elif hit.attribution_label == "harmful_hit":
                summary.harmful_hits += 1
            else:
                summary.neutral_hits += 1

        for entry_id in trace.missed_card_ids:
            summary = summaries[entry_id]
            summary.missed_opportunities += 1
            if trace.scenario_id not in summary.scenario_ids:
                summary.scenario_ids.append(trace.scenario_id)

        if trace.has_skill_gap:
            gap_key = (
                trace.stage,
                trace.role,
                trace.department,
                trace.observed_action_type,
                trace.gap_target,
            )
            gap = gaps.get(gap_key)
            if gap is None:
                gap = MissingSkillSummary(
                    gap_id=f"gap_{trace.observed_action_type}_{trace.gap_target}".lower().replace(" ", "_"),
                    stage=trace.stage,
                    role=trace.role,
                    department=trace.department,
                    action_type=trace.observed_action_type,
                    target_action=trace.gap_target if trace.observed_action_type == "request_test" else None,
                    target_diagnosis_shift=trace.gap_target if trace.observed_action_type == "diagnosis_ready" else None,
                )
                gaps[gap_key] = gap
            gap.occurrence_count += 1
            if trace.scenario_id not in gap.scenario_ids:
                gap.scenario_ids.append(trace.scenario_id)

    return SkillAttributionReport(
        card_summaries=list(summaries.values()),
        missing_skill_summaries=list(gaps.values()),
    )
