"""Typed records for EvoMed learning-loop artifacts."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class RawScenarioArtifacts:
    """Raw per-scenario logs loaded from an existing run directory."""

    scenario_dir: Path
    scenario_result: Dict[str, Any]
    dialogue_history: List[Dict[str, Any]] = field(default_factory=list)
    consultation_history: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class CanonicalStep:
    """One normalized action step with a lightweight state snapshot."""

    scenario_id: int
    stage: str
    role: str
    positives: List[str] = field(default_factory=list)
    negatives: List[str] = field(default_factory=list)
    tests: List[str] = field(default_factory=list)
    route_decision: Dict[str, Any] = field(default_factory=dict)
    action_type: str = ""
    action_payload: str = ""
    memory_entry_ids: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class RetrievalHit:
    """One ranked card hit for an offline retrieval query."""

    entry_id: str
    score: float
    matched_terms: List[str] = field(default_factory=list)
    supports_observed_action: bool = False
    attribution_label: str = "neutral_hit"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class StepRetrievalTrace:
    """Per-step offline retrieval trace used for attribution and evolution."""

    scenario_id: int
    step_index: int
    stage: str
    role: str
    department: str
    observed_action_type: str
    observed_action_payload: str
    top_hits: List[RetrievalHit] = field(default_factory=list)
    supporting_card_ids: List[str] = field(default_factory=list)
    missed_card_ids: List[str] = field(default_factory=list)
    has_skill_gap: bool = False
    gap_target: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "scenario_id": self.scenario_id,
            "step_index": self.step_index,
            "stage": self.stage,
            "role": self.role,
            "department": self.department,
            "observed_action_type": self.observed_action_type,
            "observed_action_payload": self.observed_action_payload,
            "top_hits": [hit.to_dict() for hit in self.top_hits],
            "supporting_card_ids": list(self.supporting_card_ids),
            "missed_card_ids": list(self.missed_card_ids),
            "has_skill_gap": self.has_skill_gap,
            "gap_target": self.gap_target,
        }


@dataclass
class CanonicalTrajectory:
    """Scenario-level canonical trajectory for offline learning."""

    scenario_id: int
    source_dir: str
    steps: List[CanonicalStep] = field(default_factory=list)
    final_outcome: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "scenario_id": self.scenario_id,
            "source_dir": self.source_dir,
            "steps": [step.to_dict() for step in self.steps],
            "final_outcome": self.final_outcome,
        }


def clone_route_decision(route_decision: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Return a detached route decision mapping."""
    return dict(route_decision or {})
