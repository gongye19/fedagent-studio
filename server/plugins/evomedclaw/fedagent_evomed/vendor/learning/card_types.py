"""Types for process cards compiled from trajectories."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ProcessCard:
    """One reusable process-memory unit compiled from trajectories."""

    entry_id: str
    memory_type: str
    stage: str
    owner_role: str
    department: str
    positive_triggers: List[str] = field(default_factory=list)
    negative_triggers: List[str] = field(default_factory=list)
    target_action: Optional[str] = None
    target_diagnosis_shift: Optional[str] = None
    minimal_rationale: str = ""
    source_cases: List[int] = field(default_factory=list)
    verifier_score: float = 0.0
    heldout_lift: float = 0.0
    false_trigger_rate: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
