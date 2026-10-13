"""Data types for privacy-preserving federated EvoMed updates."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class FederatedCardDelta:
    """Privacy-preserving card update exported from one local site."""

    card_signature: str
    memory_type: str
    stage: str
    owner_role: str
    department: str
    positive_triggers: List[str] = field(default_factory=list)
    negative_triggers: List[str] = field(default_factory=list)
    target_action: Optional[str] = None
    target_diagnosis_shift: Optional[str] = None
    support_count: int = 0
    helpful_hits: int = 0
    harmful_hits: int = 0
    missed_opportunities: int = 0
    neutral_hits: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "FederatedCardDelta":
        return cls(
            card_signature=str(payload["card_signature"]),
            memory_type=str(payload["memory_type"]),
            stage=str(payload["stage"]),
            owner_role=str(payload["owner_role"]),
            department=str(payload["department"]),
            positive_triggers=list(payload.get("positive_triggers") or []),
            negative_triggers=list(payload.get("negative_triggers") or []),
            target_action=payload.get("target_action"),
            target_diagnosis_shift=payload.get("target_diagnosis_shift"),
            support_count=int(payload.get("support_count") or 0),
            helpful_hits=int(payload.get("helpful_hits") or 0),
            harmful_hits=int(payload.get("harmful_hits") or 0),
            missed_opportunities=int(payload.get("missed_opportunities") or 0),
            neutral_hits=int(payload.get("neutral_hits") or 0),
        )


@dataclass
class FederatedSiteDelta:
    """An anonymized site export suitable for central aggregation."""

    site_id: str
    cards: List[FederatedCardDelta] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "site_id": self.site_id,
            "cards": [card.to_dict() for card in self.cards],
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "FederatedSiteDelta":
        return cls(
            site_id=str(payload["site_id"]),
            cards=[
                FederatedCardDelta.from_dict(item)
                for item in payload.get("cards", [])
            ],
            metadata=dict(payload.get("metadata") or {}),
        )
