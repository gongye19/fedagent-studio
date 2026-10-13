"""Container for compiled process cards."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

from fedagent_evomed.vendor.learning.card_types import ProcessCard


@dataclass
class CardBank:
    """Static collection of process cards."""

    cards: List[ProcessCard] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "cards": [card.to_dict() for card in self.cards],
            "metadata": dict(self.metadata),
        }
