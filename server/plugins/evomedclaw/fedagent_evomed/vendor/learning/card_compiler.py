"""Compile canonical trajectories into static process cards."""

from __future__ import annotations

from typing import Iterable, List

from fedagent_evomed.vendor.learning.card_bank import CardBank
from fedagent_evomed.vendor.learning.card_types import ProcessCard
from fedagent_evomed.vendor.learning.types import CanonicalStep, CanonicalTrajectory


def _default_department(step: CanonicalStep) -> str:
    primary = step.route_decision.get("primary_department")
    return str(primary or "general_internal_medicine")


def _step_triggers(step: CanonicalStep, trajectory: CanonicalTrajectory) -> tuple[list[str], list[str]]:
    positives = list(step.positives)
    negatives = list(step.negatives)
    if positives or negatives:
        return positives, negatives

    for candidate in trajectory.steps:
        if candidate.positives:
            positives = list(candidate.positives)
            break
    for candidate in trajectory.steps:
        if candidate.negatives:
            negatives = list(candidate.negatives)
            break
    return positives, negatives


def _score_card(trajectory: CanonicalTrajectory) -> tuple[float, float, float]:
    if trajectory.final_outcome.get("is_correct"):
        return 1.0, 0.1, 0.0
    return 0.0, 0.0, 1.0


def _build_card(
    *,
    trajectory: CanonicalTrajectory,
    step: CanonicalStep,
    memory_type: str,
    index: int,
    target_action: str | None = None,
    target_diagnosis_shift: str | None = None,
    rationale: str,
) -> ProcessCard:
    positives, negatives = _step_triggers(step, trajectory)
    verifier_score, heldout_lift, false_trigger_rate = _score_card(trajectory)
    return ProcessCard(
        entry_id=f"{memory_type}_{trajectory.scenario_id}_{index}",
        memory_type=memory_type,
        stage=step.stage,
        owner_role=step.role,
        department=_default_department(step),
        positive_triggers=positives,
        negative_triggers=negatives,
        target_action=target_action,
        target_diagnosis_shift=target_diagnosis_shift,
        minimal_rationale=rationale,
        source_cases=[trajectory.scenario_id],
        verifier_score=verifier_score,
        heldout_lift=heldout_lift,
        false_trigger_rate=false_trigger_rate,
    )


def compile_card_bank(trajectories: Iterable[CanonicalTrajectory]) -> CardBank:
    """Compile a deterministic static card bank from canonical trajectories."""
    trajectory_list = list(trajectories)
    cards: List[ProcessCard] = []
    for trajectory in trajectory_list:
        compiled_count = 0
        final_answer = str(trajectory.final_outcome.get("answer") or "").strip()
        for step in trajectory.steps:
            if step.action_type == "request_test":
                cards.append(
                    _build_card(
                        trajectory=trajectory,
                        step=step,
                        memory_type="test_card",
                        index=compiled_count,
                        target_action=step.action_payload,
                        rationale="Prefer this test pattern for similar evidence states.",
                    )
                )
                compiled_count += 1
            elif step.action_type == "route_decision":
                cards.append(
                    _build_card(
                        trajectory=trajectory,
                        step=step,
                        memory_type="route_card",
                        index=compiled_count,
                        target_action=str(step.route_decision.get("primary_department") or ""),
                        rationale="Use this routing decision for matching consultation states.",
                    )
                )
                compiled_count += 1
            elif step.action_type == "hospital_opinion":
                cards.append(
                    _build_card(
                        trajectory=trajectory,
                        step=step,
                        memory_type="clue_card",
                        index=compiled_count,
                        target_diagnosis_shift=final_answer,
                        rationale="Specialist clue pattern supports this diagnosis shift.",
                    )
                )
                compiled_count += 1
            elif step.action_type == "diagnosis_ready":
                cards.append(
                    _build_card(
                        trajectory=trajectory,
                        step=step,
                        memory_type="synthesis_card",
                        index=compiled_count,
                        target_diagnosis_shift=final_answer,
                        rationale="Post-consult synthesis should resolve toward this diagnosis.",
                    )
                )
                compiled_count += 1

        if not trajectory.final_outcome.get("is_correct"):
            last_step = trajectory.steps[-1]
            cards.append(
                _build_card(
                    trajectory=trajectory,
                    step=last_step,
                    memory_type="error_card",
                    index=compiled_count,
                    target_diagnosis_shift=final_answer,
                    rationale="Avoid the observed incorrect resolution for similar states.",
                )
            )

    return CardBank(
        cards=cards,
        metadata={"num_trajectories": len(trajectory_list)},
    )
