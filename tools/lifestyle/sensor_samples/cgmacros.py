"""Meal contexts and separate processed-CGM references; glucose never enters input."""

import csv
from collections import Counter, defaultdict
from datetime import datetime, timedelta

from .common import load_jsonl, number, rounded, sample_id
from .metrics import positive_area


def channel_window(series, anchor, device, policy):
    values, rows = [], []
    diagnostics = Counter(
        missing_rows=0,
        missing_values=0,
        invalid_values=0,
        out_of_range=0,
        at_lower_bound=0,
        at_upper_bound=0,
    )
    low, high = policy["glucoseRange"]
    start, stop = policy["baselineOffsets"][0], policy["postOffsets"][1]
    for offset in range(start, stop + 1):
        row = series.get(
            (anchor + timedelta(minutes=offset)).isoformat(timespec="seconds")
        )
        if row is None:
            diagnostics["missing_rows"] += 1
            continue
        raw = row[device]
        if not raw.strip():
            diagnostics["missing_values"] += 1
            continue
        value = number(raw)
        if value is None:
            diagnostics["invalid_values"] += 1
            continue
        if not low <= value <= high:
            diagnostics["out_of_range"] += 1
        diagnostics["at_lower_bound"] += int(value == low)
        diagnostics["at_upper_bound"] += int(value == high)
        values.append(value)
        rows.append(row["source_rows"])
    valid = not any(
        diagnostics[k]
        for k in ["missing_rows", "missing_values", "invalid_values", "out_of_range"]
    )
    result = {"valid": valid, "diagnostics": dict(diagnostics)}
    if valid:
        n = -start
        baseline, post = sum(values[:n]) / n, values[n:]
        result["outcome"] = {
            "baseline_mg_dl": rounded(baseline),
            "peak_delta_mg_dl": rounded(max(post) - baseline),
            "positive_iauc_120_mg_dl_min": rounded(positive_area(post, baseline)),
            "boundary_censoring_possible": bool(
                diagnostics["at_lower_bound"] or diagnostics["at_upper_bound"]
            ),
        }
        result["source_rows"] = rows
    return result


def prior_activity(series, anchor, policy):
    rows = [
        series.get((anchor - timedelta(minutes=i)).isoformat(timespec="seconds"))
        for i in range(1, policy["priorActivityMinutes"] + 1)
    ]
    output = {"window_minutes": policy["priorActivityMinutes"]}
    for field, alias in [
        ("heart_rate_bpm", "heart_rate_bpm"),
        ("mets", "mets"),
        ("activity_kcal", "activity_kcal"),
    ]:
        values = [
            number(row[field]) for row in rows if row and number(row[field]) is not None
        ]
        if field == "heart_rate_bpm":
            values = [v for v in values if v > 0]
        output[alias + "_observed_minutes"] = len(values)
        if field == "activity_kcal":
            output[alias + "_sum"] = (
                rounded(sum(values))
                if len(values) == policy["priorActivityMinutes"]
                else None
            )
        else:
            output[alias + "_mean"] = (
                rounded(sum(values) / len(values))
                if len(values) >= policy["meanMinimumCoverage"]
                else None
            )
    return output


def meal_input(meal, profile, activity):
    numeric = profile["numeric_clean"]
    return {
        "profile": {
            "age_years": numeric.get("Age") or None,
            "sex_code": profile["raw"].get("Gender") or None,
            "bmi": numeric.get("BMI") or None,
            "weight_kg": profile.get("weight_kg") or None,
            "height_cm": profile.get("height_cm") or None,
            "fasting_glucose_mg_dl": numeric.get("Fasting GLU - PDL (Lab)") or None,
        },
        "logged_meal": {
            "type": meal["meal_type"],
            "nutrition_estimates": meal["logged_nutrients"],
            "intake_status": "logged nutrients; actual consumed amount/unit unverified",
        },
        "prior_activity": activity,
    }


def prepare(root, policy):
    meals = load_jsonl(root / "cgmacros/meals.jsonl")
    profiles = {
        r["participant_id"]: r for r in load_jsonl(root / "cgmacros/participants.jsonl")
    }
    series, food_times = defaultdict(dict), defaultdict(set)
    with (root / "cgmacros/sensor_grid.csv").open(newline="") as stream:
        for row in csv.DictReader(stream):
            series[row["participant_id"]][row["local_timestamp"]] = row
    for meal in meals:
        food_times[meal["participant_id"]].add(
            datetime.fromisoformat(meal["local_timestamp"])
        )
    untyped = load_jsonl(root / "cgmacros/untyped_meal_fields.jsonl")
    unknown_food = 0
    for row in untyped:
        raw = row["raw"]
        if any(
            raw.get(k, "").strip() and number(raw[k]) != 0
            for k in ["Calories", "Carbs", "Protein", "Fat", "Fiber"]
        ):
            unknown_food += 1
            food_times[row["participant_id"]].add(
                datetime.fromisoformat(raw["Timestamp"])
            )
    cases, audits, counts = [], [], Counter()
    for meal in meals:
        pid, timestamp = meal["participant_id"], meal["local_timestamp"]
        anchor, reasons = datetime.fromisoformat(timestamp), []
        if not meal["nutrition_candidate"] or meal["quality_flags"]:
            reasons.append("source_quality_flags")
        amount = number(meal["amount_consumed_raw"])
        if meal["amount_unit_status"] == "column_absent":
            reasons.append("amount_column_absent")
        elif amount is None:
            reasons.append("amount_missing_or_invalid")
        elif amount <= 0:
            reasons.append("amount_nonpositive")
        if any(
            0
            < abs((other - anchor).total_seconds())
            <= policy["foodExclusionMinutes"] * 60
            for other in food_times[pid]
        ):
            reasons.append("nearby_food_event")
        devices = {
            device: channel_window(series[pid], anchor, device, policy)
            for device in policy["devices"]
        }
        selected = next((d for d in policy["devices"] if devices[d]["valid"]), None)
        if selected is None:
            for issue in [
                "missing_rows",
                "missing_values",
                "invalid_values",
                "out_of_range",
            ]:
                if any(d["diagnostics"][issue] for d in devices.values()):
                    reasons.append("cgm_" + issue)
        identifier = sample_id("cgmacros", pid, timestamp)
        audits.append(
            {
                "id": identifier,
                "participant_id": pid,
                "anchor": timestamp,
                "eligible": not reasons,
                "reasons": reasons,
                "primary_reason": reasons[0] if reasons else None,
                "devices": {
                    name: {"valid": d["valid"], **d["diagnostics"]}
                    for name, d in devices.items()
                },
                "source": meal["source"],
            }
        )
        if reasons:
            counts[reasons[0]] += 1
            continue
        outcomes = {name: d["outcome"] for name, d in devices.items() if d["valid"]}
        cases.append(
            {
                "id": identifier,
                "participant_id": pid,
                "input": meal_input(
                    meal, profiles[pid], prior_activity(series[pid], anchor, policy)
                ),
                "observed_outcome": {
                    **outcomes[selected],
                    "primary_device": selected,
                    "by_device": outcomes,
                },
                "provenance": {
                    "meal": meal["source"],
                    "profile": profiles[pid]["source"],
                    "anchor": timestamp,
                    "window_start": (
                        anchor
                        + timedelta(
                            minutes=min(
                                policy["baselineOffsets"][0],
                                -policy["priorActivityMinutes"],
                            )
                        )
                    ).isoformat(timespec="seconds"),
                    "reference_window_start": (
                        anchor + timedelta(minutes=policy["baselineOffsets"][0])
                    ).isoformat(timespec="seconds"),
                    "window_end": (
                        anchor + timedelta(minutes=policy["postOffsets"][1])
                    ).isoformat(timespec="seconds"),
                    "sensor_member": meal["source"]["member"],
                    "device_source_rows": {
                        name: d["source_rows"]
                        for name, d in devices.items()
                        if d["valid"]
                    },
                    "amount_raw": meal["amount_consumed_raw"],
                    "amount_unit_status": meal["amount_unit_status"],
                    "reference_status": "processed observational sensor reference, not intervention benefit",
                },
            }
        )
    return (
        cases,
        audits,
        {
            "source_records": len(meals),
            "eligible": len(cases),
            "excluded": len(meals) - len(cases),
            "first_exclusion_reason": dict(counts),
            "untyped_image_or_other_events": len(untyped),
            "untyped_potential_food_events": unknown_food,
        },
    )
