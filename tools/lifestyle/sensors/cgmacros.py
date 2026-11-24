"""Keep the two glucose grids distinct and prepare logged meal candidates."""

import re
from collections import Counter
from decimal import Decimal

from .common import csv_writer, emit, local_time, read_table, scaled, unique_rows
from .supplements import prepare_supplements

SIGNALS = {
    "Libre GL": "libre_mg_dl",
    "Dexcom GL": "dexcom_mg_dl",
    "HR": "heart_rate_bpm",
    "Calories (Activity)": "activity_kcal",
    "Steps": "steps",
    "METs": "mets_times_10_raw",
    "Intensity": "activity_intensity_raw",
}
NUTRIENTS = {
    "Calories": "kcal",
    "Carbs": "carbs_g",
    "Protein": "protein_g",
    "Fat": "fat_g",
    "Fiber": "fiber_g",
}
ALLOWED = (
    set(SIGNALS)
    | set(NUTRIENTS)
    | {
        "source_index",
        "Timestamp",
        "Meal Type",
        "Amount Consumed",
        "Image path",
        "Sugar",
        "RecordIndex",
    }
)


def amount_status(rows) -> str:
    if "Amount Consumed" not in rows[0].data:
        return "column_absent"
    values = []
    for row in rows:
        raw = row.data.get("Amount Consumed", "")
        if raw.strip():
            try:
                value = Decimal(raw)
                if not value.is_finite() or value < 0:
                    return "mixed_or_unknown"
                values.append(value)
            except ArithmeticError:
                return "mixed_or_unknown"
    if not values:
        return "all_missing"
    if max(values) <= 9:
        return "fraction_or_serving_like_unverified"
    if (
        max(values) <= 100
        and Decimal(100) in values
        and not any(0 < v <= 9 for v in values)
    ):
        return "percent_like_unverified"
    return "mixed_or_unknown"


def prepare(archive, out, audit, quarantine, policy) -> dict:
    members = sorted(
        n
        for n in archive.namelist()
        if re.fullmatch(r"CGMacros/CGMacros-\d{3}/CGMacros-\d{3}\.csv", n)
    )
    fields = [
        "participant_id",
        "local_timestamp",
        "source_member",
        "source_rows",
        "source_index",
        *SIGNALS.values(),
        "mets",
    ]
    stream, writer = csv_writer(out / "sensor_grid.csv", fields)
    summary = Counter(participants=len(members), untypedMealFieldRows=0)
    ids, participant_amounts = set(), {}
    try:
        with (
            (out / "meals.jsonl").open("w") as meals,
            (out / "untyped_meal_fields.jsonl").open("w") as untyped,
        ):
            for member in members:
                source_id = member.split("/")[1].removeprefix("CGMacros-")
                if not member.endswith(f"CGMacros-{source_id}.csv"):
                    raise ValueError("participant path mismatch")
                ids.add(int(source_id))
                headers, rows = read_table(archive, member, audit)
                if set(headers) - ALLOWED or not (
                    {"Timestamp", "Libre GL", "Dexcom GL", "Meal Type"} <= set(headers)
                ):
                    raise ValueError(
                        f"unrecognized CGMacros schema: {member}: {headers}"
                    )
                participant_amounts[source_id] = amount_status(rows)
                rows = unique_rows(
                    rows,
                    lambda r: (local_time(r.data["Timestamp"]),),
                    audit,
                    quarantine,
                )
                for row in rows:
                    timestamp = local_time(row.data["Timestamp"])
                    signals = {
                        alias: audit.number(row, name, minimum=0)
                        for name, alias in SIGNALS.items()
                    }
                    for name in ["Libre GL", "Dexcom GL"]:
                        value = signals[SIGNALS[name]]
                        if value and not 40 <= Decimal(value) <= 400:
                            audit.issue(
                                row, name, "outside_published_range_retained", value
                            )
                    signals["mets"] = (
                        scaled(signals["mets_times_10_raw"], "0.1")
                        if signals["mets_times_10_raw"]
                        else ""
                    )
                    writer.writerow(
                        {
                            "participant_id": f"cgmacros:{source_id}",
                            "local_timestamp": timestamp,
                            "source_member": member,
                            "source_rows": ";".join(map(str, row.lines)),
                            "source_index": row.data.get("source_index", ""),
                            **signals,
                        }
                    )
                    summary["sensorRows"] += 1
                    if row.data["Meal Type"].strip():
                        record = meal(row, source_id, timestamp, archive, audit, policy)
                        record["amount_unit_status"] = participant_amounts[source_id]
                        emit(meals, record)
                        summary["loggedMeals"] += 1
                        summary["nutritionCandidates"] += int(
                            record["nutrition_candidate"]
                        )
                        summary["unflaggedNutritionCandidates"] += int(
                            record["nutrition_candidate"]
                            and not record["quality_flags"]
                        )
                        for flag in record["quality_flags"]:
                            summary[f"mealFlag:{flag}"] += 1
                    elif any(
                        row.data.get(field, "").strip()
                        for field in [
                            *NUTRIENTS,
                            "Amount Consumed",
                            "Image path",
                            "Sugar",
                        ]
                    ):
                        summary["untypedMealFieldRows"] += 1
                        audit.issue(row, "meal", "meal_fields_without_meal_type")
                        emit(
                            untyped,
                            {
                                "participant_id": f"cgmacros:{source_id}",
                                "source": row.origin(),
                                "raw": row.data,
                            },
                        )
    finally:
        stream.close()
    supplements = prepare_supplements(archive, out, ids, audit, quarantine)
    return {
        **summary,
        "amountUnitByParticipant": participant_amounts,
        "supplements": supplements,
        "glucoseInterpretation": "Published interpolated local-time grids, Libre native 15min / Dexcom native 5min; not independent minute measurements.",
        "candidateMeaning": "Logged nutrition only. Portion unit unverified; no PPGR, no intervention or recommendation labels.",
    }


def meal(row, source_id, timestamp, archive, audit, policy) -> dict:
    raw_type = row.data["Meal Type"].strip()
    kind = policy["mealTypes"].get(raw_type.lower(), "")
    values = {
        alias: audit.number(row, field, minimum=0) for field, alias in NUTRIENTS.items()
    }
    flags = []
    if not kind:
        flags.append("unknown_meal_type")
    if any(not v for v in values.values()):
        flags.append("missing_or_invalid_nutrients")
    if all(v and Decimal(v) == 0 for v in values.values()):
        flags.append("all_zero_nutrition")
    if (
        values["fiber_g"]
        and values["carbs_g"]
        and Decimal(values["fiber_g"]) > Decimal(values["carbs_g"])
    ):
        flags.append("fiber_exceeds_carbs")
    if any(
        v
        and (
            Decimal(v) > policy["nutrientRanges"][field]["max"]
            or Decimal(v) < policy["nutrientRanges"][field].get("min", 0)
        )
        for field, v in values.items()
    ):
        flags.append("outside_published_nutrient_range")
    image = row.data.get("Image path", "").strip()
    image_member = f"CGMacros/CGMacros-{source_id}/{image}" if image else ""
    # Never resolve a filesystem path or extract an untrusted image reference.
    if (
        not image
        or image.startswith("/")
        or ".." in image.split("/")
        or image_member not in archive.namelist()
    ):
        flags.append("missing_or_invalid_image_reference")
        image_member = ""
    for flag in flags:
        audit.issue(row, "meal", flag)
    candidate = bool(kind and all(values.values()) and Decimal(values["kcal"]) > 0)
    return {
        "participant_id": f"cgmacros:{source_id}",
        "local_timestamp": timestamp,
        "source": row.origin(),
        "meal_type": kind,
        "meal_type_raw": raw_type,
        "logged_nutrients": values,
        "amount_consumed_raw": row.data.get("Amount Consumed", ""),
        "sugar_g_raw": row.data.get("Sugar", ""),
        "record_index_raw": row.data.get("RecordIndex", ""),
        "image_member": image_member,
        "image_reference_raw": image,
        "nutrition_candidate": candidate,
        "quality_flags": flags,
    }
