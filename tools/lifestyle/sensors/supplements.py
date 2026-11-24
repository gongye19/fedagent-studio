"""Baseline and microbiome tables; no cross-cohort identity inference."""

from decimal import Decimal

from .common import csv_writer, emit, read_table, scaled, unique_rows


def subject_key(row):
    value = Decimal(row.data["subject"])
    if not value.is_finite() or value != value.to_integral_value() or value <= 0:
        raise ValueError("invalid subject")
    return (int(value),)


def prepare_supplements(archive, out, active_ids, audit, quarantine) -> dict:
    summary = {}
    for table in ["bio", "gut_health_test", "microbes"]:
        member = f"CGMacros/{table}.csv"
        headers, rows = read_table(archive, member, audit)
        if headers[0] != "subject":
            raise ValueError(f"missing subject header: {member}")
        rows = unique_rows(rows, subject_key, audit, quarantine)
        if table == "bio":
            with (out / "participants.jsonl").open("w") as stream:
                for row in rows:
                    emit(stream, baseline(row, active_ids, audit))
        else:
            fields = ["participant_id", "has_sensor_data", "source_rows", *headers[1:]]
            stream, writer = csv_writer(out / f"{table}.csv", fields)
            try:
                for row in rows:
                    number = subject_key(row)[0]
                    values = {
                        h: audit.number(
                            row,
                            h,
                            minimum=0 if table == "microbes" else 1,
                            maximum=1 if table == "microbes" else 3,
                            integer=True,
                        )
                        for h in headers[1:]
                    }
                    writer.writerow(
                        {
                            "participant_id": f"cgmacros:{number:03}",
                            "has_sensor_data": number in active_ids,
                            "source_rows": ";".join(map(str, row.lines)),
                            **values,
                        }
                    )
            finally:
                stream.close()
        summary[table] = {
            "rows": len(rows),
            "columns": len(headers),
            "withoutSensorData": [
                subject_key(r)[0] for r in rows if subject_key(r)[0] not in active_ids
            ],
        }
    return summary


def baseline(row, active_ids, audit):
    number = subject_key(row)[0]
    clean = {}
    categorical = {
        "Gender",
        "Self-identify",
        "Collection time PDL (Lab)",
        "Time (t)",
        "Time (t)__2",
        "Time (t)__3",
    }
    for field, raw in row.data.items():
        if field in categorical or field in {"subject", "source_index"}:
            continue
        value = audit.number(row, field, minimum=0)
        if (field == "LDL (Cal)" and value and Decimal(value) == 800) or (
            field == "VLDL (Cal)" and value and Decimal(value) == 400
        ):
            audit.issue(row, field, "documented_error_removed", raw)
            value = ""
        if field == "Cho/HDL Ratio" and value and Decimal(value) == 400:
            audit.issue(row, field, "suspicious_ratio_retained", raw)
        clean[field] = value
    weight, height = clean.get("Body weight", ""), clean.get("Height", "")
    return {
        "participant_id": f"cgmacros:{number:03}",
        "has_sensor_data": number in active_ids,
        "source": row.origin(),
        "raw": row.data,
        "numeric_clean": clean,
        "weight_kg": scaled(weight, "0.45359237") if weight else "",
        "height_cm": scaled(height, "2.54") if height else "",
        "hba1c_unit_status": "unresolved: dictionary says mmol/mol but released values 4.6..8.5; no conversion",
    }
