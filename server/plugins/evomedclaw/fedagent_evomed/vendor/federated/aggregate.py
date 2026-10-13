"""Central aggregation for privacy-preserving federated EvoMed deltas."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

from fedagent_evomed.vendor.federated.types import FederatedCardDelta, FederatedSiteDelta
from fedagent_evomed.vendor.learning.card_bank import CardBank
from fedagent_evomed.vendor.learning.card_types import ProcessCard
from fedagent_evomed.vendor.learning.legacy_bank_export import export_legacy_bank


def _read_json(path: str | Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _write_json(path: str | Path, payload: dict | list) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _guidance_for_card(card: FederatedCardDelta) -> str:
    guidance = {
        "test_card": "Prefer this test pattern when the same evidence configuration recurs.",
        "route_card": "Prefer this routing choice when the same consultation state recurs.",
        "clue_card": "Use this specialist clue pattern when the same evidence cluster recurs.",
        "synthesis_card": "Use this synthesis pattern when the same post-consult evidence recurs.",
        "error_card": "Avoid this failure pattern when the same evidence cluster recurs.",
    }
    return guidance.get(card.memory_type, "Use this shared clinical process pattern when the same state recurs.")


def _merged_stats(cards: List[Tuple[str, FederatedCardDelta]]) -> Tuple[int, int, int, int, int, int]:
    distinct_sites = len({site_id for site_id, _ in cards})
    support_count = sum(card.support_count for _, card in cards)
    helpful_hits = sum(card.helpful_hits for _, card in cards)
    harmful_hits = sum(card.harmful_hits for _, card in cards)
    missed = sum(card.missed_opportunities for _, card in cards)
    neutral = sum(card.neutral_hits for _, card in cards)
    return distinct_sites, support_count, helpful_hits, harmful_hits, missed, neutral


def aggregate_site_deltas(
    site_deltas: Iterable[FederatedSiteDelta],
    *,
    min_sites_per_card: int = 1,
) -> CardBank:
    """Merge anonymized site deltas into a global shared bank."""
    site_delta_list = list(site_deltas)
    grouped: Dict[str, List[Tuple[str, FederatedCardDelta]]] = defaultdict(list)
    site_ids = [delta.site_id for delta in site_delta_list]

    for delta in site_delta_list:
        for card in delta.cards:
            grouped[card.card_signature].append((delta.site_id, card))

    cards: list[ProcessCard] = []
    kept_signatures = 0
    for signature in sorted(grouped):
        grouped_cards = grouped[signature]
        distinct_sites, support_count, helpful_hits, harmful_hits, missed, neutral = _merged_stats(grouped_cards)
        if distinct_sites < min_sites_per_card:
            continue

        exemplar = grouped_cards[0][1]
        denom = max(1, helpful_hits + harmful_hits + neutral)
        cards.append(
            ProcessCard(
                entry_id=f"fed_{signature}",
                memory_type=exemplar.memory_type,
                stage=exemplar.stage,
                owner_role=exemplar.owner_role,
                department=exemplar.department,
                positive_triggers=list(exemplar.positive_triggers),
                negative_triggers=list(exemplar.negative_triggers),
                target_action=exemplar.target_action,
                target_diagnosis_shift=exemplar.target_diagnosis_shift,
                minimal_rationale=_guidance_for_card(exemplar),
                source_cases=[],
                verifier_score=helpful_hits / denom,
                heldout_lift=helpful_hits / max(1, support_count),
                false_trigger_rate=harmful_hits / max(1, helpful_hits + harmful_hits),
            )
        )
        kept_signatures += 1

    return CardBank(
        cards=cards,
        metadata={
            "privacy_mode": "delta_only",
            "num_source_sites": len(set(site_ids)),
            "num_site_deltas": len(site_delta_list),
            "min_sites_per_card": int(min_sites_per_card),
            "cards_meeting_site_threshold": kept_signatures,
        },
    )


def aggregate_site_delta_paths(
    *,
    site_delta_paths: Iterable[str | Path],
    output_dir: str | Path,
    min_sites_per_card: int = 1,
) -> CardBank:
    site_deltas = [
        FederatedSiteDelta.from_dict(_read_json(path))
        for path in site_delta_paths
    ]
    aggregated = aggregate_site_deltas(site_deltas, min_sites_per_card=min_sites_per_card)
    output_root = Path(output_dir)
    _write_json(output_root / "global_card_bank.json", aggregated.to_dict())
    export_legacy_bank(aggregated, output_root / "global_memory_bank.json")
    _write_json(
        output_root / "aggregation_report.json",
        {
            "num_site_deltas": len(site_deltas),
            "site_ids": [delta.site_id for delta in site_deltas],
            "num_global_cards": len(aggregated.cards),
            "metadata": dict(aggregated.metadata),
        },
    )
    return aggregated
