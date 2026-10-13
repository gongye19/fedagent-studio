"""Build offline retrieval traces from trajectories and process cards."""

from __future__ import annotations

from typing import Iterable, List

from fedagent_evomed.vendor.learning.card_bank import CardBank
from fedagent_evomed.vendor.learning.card_types import ProcessCard
from fedagent_evomed.vendor.learning.retrieve_index import build_retrieval_index
from fedagent_evomed.vendor.learning.retrieve_ranker import normalize_text, step_department
from fedagent_evomed.vendor.learning.types import CanonicalStep, CanonicalTrajectory, RetrievalHit, StepRetrievalTrace


def _iter_cards(card_bank_or_cards: CardBank | Iterable[ProcessCard]) -> List[ProcessCard]:
    if isinstance(card_bank_or_cards, CardBank):
        return list(card_bank_or_cards.cards)
    return list(card_bank_or_cards)


def card_supports_step(card: ProcessCard, step: CanonicalStep) -> bool:
    """Return whether the card supports the observed step action."""
    observed_payload = normalize_text(step.action_payload)

    if card.memory_type == "test_card" and step.action_type == "request_test":
        return normalize_text(card.target_action) == observed_payload

    if card.memory_type == "route_card" and step.action_type == "route_decision":
        primary = normalize_text(str(step.route_decision.get("primary_department") or step.action_payload))
        return normalize_text(card.target_action) == primary

    if card.memory_type in {"clue_card", "synthesis_card", "error_card"} and step.action_type == "diagnosis_ready":
        return normalize_text(card.target_diagnosis_shift) == observed_payload

    return False


def _supporting_cards(cards: Iterable[ProcessCard], step: CanonicalStep) -> List[ProcessCard]:
    department = step_department(step)
    return [
        card
        for card in cards
        if card.stage == step.stage
        and card.owner_role == step.role
        and card.department in {department, "general_internal_medicine"}
        and card_supports_step(card, step)
    ]


def generate_retrieval_traces(
    trajectories: Iterable[CanonicalTrajectory],
    card_bank_or_cards: CardBank | Iterable[ProcessCard],
    *,
    top_k: int = 3,
) -> List[StepRetrievalTrace]:
    """Replay deterministic retrieval over canonical steps."""
    cards = _iter_cards(card_bank_or_cards)
    index = build_retrieval_index(cards)
    traces: List[StepRetrievalTrace] = []

    for trajectory in trajectories:
        is_correct = bool(trajectory.final_outcome.get("is_correct"))
        for step_index, step in enumerate(trajectory.steps):
            raw_hits = index.retrieve(step, top_k=top_k)
            supporting_cards = _supporting_cards(cards, step)
            supporting_ids = [card.entry_id for card in supporting_cards]
            retrieved_support_ids = set()
            top_hits: List[RetrievalHit] = []

            for hit in raw_hits:
                supports = hit.entry_id in supporting_ids
                label = "neutral_hit"
                if supports and is_correct:
                    label = "helpful_hit"
                    retrieved_support_ids.add(hit.entry_id)
                elif supports and not is_correct:
                    label = "harmful_hit"
                    retrieved_support_ids.add(hit.entry_id)
                top_hits.append(
                    RetrievalHit(
                        entry_id=hit.entry_id,
                        score=hit.score,
                        matched_terms=list(hit.matched_terms),
                        supports_observed_action=supports,
                        attribution_label=label,
                    )
                )

            missed_card_ids: List[str] = []
            has_skill_gap = False
            gap_target = ""
            if is_correct:
                if supporting_ids:
                    missed_card_ids = [entry_id for entry_id in supporting_ids if entry_id not in retrieved_support_ids]
                elif step.action_payload:
                    has_skill_gap = True
                    gap_target = step.action_payload

            traces.append(
                StepRetrievalTrace(
                    scenario_id=trajectory.scenario_id,
                    step_index=step_index,
                    stage=step.stage,
                    role=step.role,
                    department=step_department(step),
                    observed_action_type=step.action_type,
                    observed_action_payload=step.action_payload,
                    top_hits=top_hits,
                    supporting_card_ids=supporting_ids,
                    missed_card_ids=missed_card_ids,
                    has_skill_gap=has_skill_gap,
                    gap_target=gap_target,
                )
            )

    return traces
