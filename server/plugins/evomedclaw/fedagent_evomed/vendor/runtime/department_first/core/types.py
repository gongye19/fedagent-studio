"""Typed records for department-first orchestration."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class RouteDecision:
    """Case-conditioned specialty routing decision."""

    primary_department: str
    secondary_department: Optional[str] = None
    confidence: float = 0.0
    reasons: List[str] = field(default_factory=list)
    score_breakdown: Dict[str, float] = field(default_factory=dict)
    should_arbitrate: bool = False
    routing_method: str = "keyword"
    metadata: Dict[str, Any] = field(default_factory=dict)

    def departments(self) -> List[str]:
        items = [self.primary_department]
        if self.secondary_department and self.secondary_department != self.primary_department:
            items.append(self.secondary_department)
        return items

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class MemoryEntry:
    """Department-scoped validated memory snippet."""

    entry_id: str
    department: str
    owner_role: str
    stage: str
    summary: str
    guidance: str
    required_evidence: List[str] = field(default_factory=list)
    contraindications: List[str] = field(default_factory=list)
    source_cases: List[int] = field(default_factory=list)
    heldout_success_rate: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SpecialistOpinion:
    """Single department specialist consultation result."""

    department: str
    model_name: str
    raw_opinion: str
    memory_ids: List[str] = field(default_factory=list)
    top_diagnosis: Optional[str] = None
    expert_models: List[str] = field(default_factory=list)
    expert_opinions: List[str] = field(default_factory=list)
    consensus_model: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ConsultationBundle:
    """Full consultation bundle including route, department opinions, and final output."""

    scenario_id: int
    consultation_request: str
    route_decision: RouteDecision
    opinions: List[SpecialistOpinion]
    final_opinion: str
    arbiter_used: bool = False

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "scenario_id": self.scenario_id,
            "consultation_request": self.consultation_request,
            "route_decision": self.route_decision.to_dict(),
            "opinions": [op.to_dict() for op in self.opinions],
            "final_opinion": self.final_opinion,
            "arbiter_used": self.arbiter_used,
        }
        return payload
