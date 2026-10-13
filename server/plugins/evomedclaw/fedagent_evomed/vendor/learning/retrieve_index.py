"""Offline retrieval index over compiled process cards."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Tuple

from fedagent_evomed.vendor.learning.card_bank import CardBank
from fedagent_evomed.vendor.learning.card_types import ProcessCard
from fedagent_evomed.vendor.learning.retrieve_ranker import score_card_for_step
from fedagent_evomed.vendor.learning.types import CanonicalStep, RetrievalHit


@dataclass
class ProcessCardRetrievalIndex:
    """Simple deterministic bucketed retrieval index."""

    buckets: Dict[Tuple[str, str], List[ProcessCard]] = field(default_factory=dict)

    def candidates(self, step: CanonicalStep) -> List[ProcessCard]:
        return list(self.buckets.get((step.stage, step.role), []))

    def retrieve(self, step: CanonicalStep, top_k: int = 3) -> List[RetrievalHit]:
        hits: List[RetrievalHit] = []
        for card in self.candidates(step):
            hit = score_card_for_step(card, step)
            if hit is not None:
                hits.append(hit)
        hits.sort(key=lambda item: item.score, reverse=True)
        return hits[:top_k]


def build_retrieval_index(card_bank_or_cards: CardBank | Iterable[ProcessCard]) -> ProcessCardRetrievalIndex:
    """Build a bucketed retrieval index from a card bank or iterable of cards."""
    if isinstance(card_bank_or_cards, CardBank):
        cards = card_bank_or_cards.cards
    else:
        cards = list(card_bank_or_cards)

    buckets: Dict[Tuple[str, str], List[ProcessCard]] = defaultdict(list)
    for card in cards:
        buckets[(card.stage, card.owner_role)].append(card)
    return ProcessCardRetrievalIndex(buckets=dict(buckets))
