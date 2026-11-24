"""Conditional call estimates, never dispatch or approval. No model dependencies."""

import hashlib
import json
import math
from collections import Counter, defaultdict


def rank(value):
    return hashlib.sha256(value.encode()).hexdigest()


def representative(cases, count):
    if count <= 0:
        return []
    groups = defaultdict(list)
    for case in sorted(cases, key=lambda case: case["id"]):
        groups[case["participant_id"]].append(case)
    result = []
    people = sorted(groups, key=rank)
    for index in range(max((len(v) for v in groups.values()), default=0)):
        for pid in people:
            if index < len(groups[pid]):
                result.append(groups[pid][index])
                if len(result) == count:
                    return result
    return result


def nonoverlap(cases):
    result, last_end = [], {}
    for case in sorted(
        cases,
        key=lambda c: (c["participant_id"], c["provenance"]["window_start"], c["id"]),
    ):
        pid, span = case["participant_id"], case["provenance"]
        if pid not in last_end or span["window_start"] > last_end[pid]:
            result.append(case)
            last_end[pid] = span["window_end"]
    return result


def allocation(cases, split, cap, minimum_sites):
    bins = [[] for _ in range(math.ceil(len(cases) / cap))]
    if not bins:
        return []
    for site in "ABC":
        for case in sorted(
            (c for c in cases if split[c["participant_id"]]["site"] == site),
            key=lambda c: c["id"],
        ):
            chosen = min(
                range(len(bins)),
                key=lambda i: (
                    len(bins[i]),
                    sum(r["site"] == site for r in bins[i]),
                    i,
                ),
            )
            bins[chosen].append({"id": case["id"], "site": site})
    if any(
        len(batch) > cap or len({r["site"] for r in batch}) < minimum_sites
        for batch in bins
    ):
        raise ValueError("cannot propose valid multisite batches at this capacity")
    if sum(map(len, bins)) != len(cases):
        raise ValueError("batch assignment lost records")
    return bins


def proposal(cases, split, policy, tier):
    learning = [c for c in cases if split[c["participant_id"]]["role"] == "learning"]
    evaluation = [
        c for c in cases if split[c["participant_id"]]["role"] == "evaluation"
    ]
    if tier in {"smoke", "first"}:
        per_site, eval_count = (2, 6) if tier == "smoke" else (10, 24)
        learning = [
            c
            for site in "ABC"
            for c in representative(
                [c for c in learning if split[c["participant_id"]]["site"] == site],
                per_site,
            )
        ]
        evaluation = representative(evaluation, eval_count)
    batches = allocation(
        learning, split, policy["maxBatchRecords"], policy["minimumSitesPerBatch"]
    )
    n, m, b = len(learning), len(evaluation), len(batches)
    base = 2 * n + 3 * b + 2 * m
    step = 10 if tier in {"smoke", "first"} else 100
    return {
        "learningCases": n,
        "evaluationCases": m,
        "batches": b,
        "normalCallsTemplate": base,
        "normalCallsWithSyntheticExplanation": base + n,
        "phasesTemplate": {
            "initialTemplate": 0,
            "reflect": n,
            "extract": n,
            "profile": b,
            "library": b,
            "proposedProbe": b,
            "twoArmAnswers": 2 * m,
            "numericScoring": 0,
        },
        "suggestedReserveScenarioCap": math.ceil(
            base * (100 + policy["reserveScenarioPercent"]) / (100 * step)
        )
        * step,
        "learningSiteCounts": dict(
            Counter(split[c["participant_id"]]["site"] for c in learning)
        ),
        "evaluationParticipants": len({c["participant_id"] for c in evaluation}),
        "learningIds": [c["id"] for c in learning],
        "evaluationIds": [c["id"] for c in evaluation],
        "batchAllocation": batches,
        "observedInputChars": sum(
            len(
                json.dumps(
                    {"input": c["input"], "observation": c["observed_outcome"]},
                    ensure_ascii=False,
                )
            )
            for c in learning
        ),
    }


def estimate(domains, splits, policy):
    proposals, views = {}, {}
    for domain, cases in domains.items():
        selected = nonoverlap(cases)
        views[domain] = sorted(c["id"] for c in selected)
        proposals[domain] = {
            tier: proposal(
                selected if tier == "nonoverlap" else cases,
                splits[domain],
                policy,
                tier,
            )
            for tier in ["smoke", "first", "all", "nonoverlap"]
        }
    return {
        "status": "estimate_only_not_approved",
        "executionApproved": False,
        "adapterImplemented": False,
        "retrievalImplemented": False,
        "proposals": proposals,
        "combinedNormalTemplate": {
            tier: sum(p[tier]["normalCallsTemplate"] for p in proposals.values())
            for tier in ["smoke", "first", "all", "nonoverlap"]
        },
        "tokenScenario": {
            "historicalPromptTokensPerChar": [0.2, 1.0],
            "endToEndTokens": None,
            "reason": "bounded retrieval/context and future adapter are undefined; historical range is not tokenizer verification",
        },
        "currencyEstimate": None,
        "notes": [
            "No current verified provider prices. No calls or spending approved.",
            "All per-batch libraries require future bounded retrieval/collection design; never paste all libraries into a prompt.",
            "Numeric answers/2M are conditional on the future validated adapter and retrieval. Qualitative recommendation safety evaluation is not included.",
            "15% is only a planning scenario, not worst-case retry cost or guaranteed completion. Earlier 850-call experiment budget does not apply.",
            "Template observation records are not genuine agent conversations; optional explanations must be marked synthetic. Confirm reuse/licensing and data-sending scope before any external call.",
        ],
    }, views
