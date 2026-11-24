"""Observation metrics only: no recommendation-effect or clinical labels."""

from collections import defaultdict
from decimal import Decimal
from itertools import pairwise

from .common import number, rounded


def positive_area(points, baseline):
    """Integrate the positive part of a piecewise-linear minute grid, including crossings."""
    area = Decimal(0)
    for left, right in pairwise(points):
        a, b = left - baseline, right - baseline
        if a >= 0 and b >= 0:
            area += (a + b) / 2
        elif a > 0 > b:
            area += a * a / (2 * (a - b))
        elif b > 0 > a:
            area += b * b / (2 * (b - a))
    return area


def macro_score(rows):
    by_person = defaultdict(lambda: {"total": 0, "valid": 0, "error": Decimal(0)})
    for row in rows:
        value = by_person[row["participant_id"]]
        value["total"] += 1
        truth, prediction = number(row["truth"]), number(row["prediction"])
        if truth is None:
            raise ValueError("invalid reference cannot be scored")
        if prediction is not None:
            value["valid"] += 1
            value["error"] += abs(prediction - truth)
    total, valid = (
        sum(v["total"] for v in by_person.values()),
        sum(v["valid"] for v in by_person.values()),
    )
    per_person = {
        pid: {
            "cases": v["total"],
            "valid": v["valid"],
            "mae": rounded(v["error"] / v["valid"]) if v["valid"] else None,
        }
        for pid, v in sorted(by_person.items())
    }
    values = [v["error"] / v["valid"] for v in by_person.values() if v["valid"]]
    return {
        "cases": total,
        "valid": valid,
        "invalid": total - valid,
        "coverage": rounded(Decimal(valid) / total) if total else None,
        "conditional_user_macro_mae": rounded(sum(values) / len(values))
        if values
        else None,
        "complete": total > 0 and total == valid,
        "participants": per_person,
    }


def local_baselines(cases, split, target):
    training, evaluation = [], []
    for case in cases:
        (
            training
            if split[case["participant_id"]]["role"] == "learning"
            else evaluation
        ).append(case)
    by_person = defaultdict(list)
    for case in training:
        by_person[case["participant_id"]].append(
            number(case["observed_outcome"][target])
        )
    if not by_person:
        raise ValueError("no training observations for local baseline")
    person_means = [sum(values) / len(values) for values in by_person.values()]
    mean = sum(person_means) / len(person_means)
    result = {
        "training_person_balanced_mean": {
            "prediction": rounded(mean),
            "score": macro_score(
                [
                    {
                        "participant_id": case["participant_id"],
                        "truth": case["observed_outcome"][target],
                        "prediction": mean,
                    }
                    for case in evaluation
                ]
            ),
        }
    }
    if target == "minutes_asleep":
        result["three_history_nights_mean"] = {
            "score": macro_score(
                [
                    {
                        "participant_id": case["participant_id"],
                        "truth": case["observed_outcome"][target],
                        "prediction": sum(
                            number(row["minutes_asleep"])
                            for row in case["input"]["history"]
                        )
                        / 3,
                    }
                    for case in evaluation
                ]
            )
        }
    return result
