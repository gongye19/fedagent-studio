"""CSV provenance, source-row accounting and conservative numeric cleaning."""

import csv
import io
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation
from pathlib import Path


def dump(path: Path, value: object) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    )


def emit(stream, value: object) -> None:
    stream.write(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    )


def scaled(raw: str, factor: str) -> str:
    value = (Decimal(raw) * Decimal(factor)).quantize(
        Decimal("0.00000001"), rounding=ROUND_HALF_EVEN
    )
    text = format(value, "f").rstrip("0").rstrip(".")
    return text if text not in {"", "-0"} else "0"


@dataclass
class Row:
    member: str
    lines: list[int]
    data: dict[str, str]

    def origin(self) -> dict:
        return {
            "member": self.member,
            "rows": self.lines,
            "sourceIndex": self.data.get("source_index", ""),
        }


class Audit:
    def __init__(self, stream):
        self.stream = stream
        self.events = Counter()
        self.empty = Counter()
        self.absent = Counter()
        self.tables = {}
        self.headers = {}

    def issue(self, row: Row, field: str, code: str, raw: object = None) -> None:
        self.events[f"{row.member}|{field}|{code}"] += 1
        emit(self.stream, {**row.origin(), "field": field, "code": code, "raw": raw})

    def number(
        self, row: Row, field: str, *, minimum=None, maximum=None, integer=False
    ) -> str:
        key = f"{row.member}|{field}"
        if field not in row.data:
            self.absent[key] += 1
            return ""
        raw = row.data[field]
        if not raw.strip():
            self.empty[key] += 1
            return ""
        try:
            value = Decimal(raw)
            if not value.is_finite():
                raise InvalidOperation
            if (
                (minimum is not None and value < Decimal(str(minimum)))
                or (maximum is not None and value > Decimal(str(maximum)))
                or (integer and value != value.to_integral_value())
            ):
                raise InvalidOperation
            # Retain the source representation for unconverted values.
            return raw.strip()
        except InvalidOperation:
            self.issue(row, field, "invalid_numeric", raw)
            return ""


def normalized_headers(original: list[str]) -> list[str]:
    headers, counts = [], Counter()
    for raw in original:
        name = raw.strip()
        if not name or name.startswith("Unnamed:"):
            name = "source_index"
        counts[name] += 1
        headers.append(name if counts[name] == 1 else f"{name}__{counts[name]}")
    if len(set(headers)) != len(headers):
        raise ValueError("ambiguous header names")
    return headers


def read_table(archive, member: str, audit: Audit) -> tuple[list[str], list[Row]]:
    with archive.open(member) as binary:
        reader = csv.reader(io.TextIOWrapper(binary, encoding="utf-8-sig", newline=""))
        original = next(reader)
        headers = normalized_headers(original)
        audit.headers[member] = list(zip(original, headers, strict=True))
        rows = []
        for line, values in enumerate(reader, 2):
            if len(values) != len(headers):
                raise ValueError(f"CSV row width mismatch: {member}:{line}")
            rows.append(Row(member, [line], dict(zip(headers, values, strict=True))))
    return headers, rows


def local_time(value: str, *, hourly=False, date_only=False) -> str:
    pattern = "%Y-%m-%d" if date_only or hourly else "%Y-%m-%d %H:%M:%S"
    parsed = datetime.strptime(value, pattern)  # noqa: DTZ007 -- released local times have no known timezone
    if parsed.strftime(pattern) != value:
        raise ValueError("noncanonical local date/time")
    return parsed.isoformat(timespec="seconds") if not (date_only or hourly) else value


def unique_rows(rows: list[Row], key, audit: Audit, quarantine) -> list[Row]:
    groups = defaultdict(list)
    stats = {
        "raw": len(rows),
        "retained": 0,
        "duplicateMerged": 0,
        "quarantined": 0,
        "rejected": 0,
    }
    for row in rows:
        try:
            identity = key(row)
            if any(v == "" for v in identity):
                raise ValueError("empty key")
            groups[identity].append(row)
        except (ValueError, InvalidOperation):
            stats["rejected"] += 1
            emit(quarantine, {**row.origin(), "reason": "invalid_key", "raw": row.data})
    kept = []
    for identity, group in sorted(groups.items()):
        payloads = {
            json.dumps(
                {k: v for k, v in row.data.items() if k != "source_index"},
                sort_keys=True,
            )
            for row in group
        }
        if len(payloads) > 1:
            stats["quarantined"] += len(group)
            for row in group:
                emit(
                    quarantine,
                    {
                        **row.origin(),
                        "reason": "conflicting_duplicate_key",
                        "raw": row.data,
                    },
                )
            continue
        row = group[0]
        row.lines = sorted(line for item in group for line in item.lines)
        stats["duplicateMerged"] += len(group) - 1
        kept.append(row)
    stats["retained"] = len(kept)
    assert stats["raw"] == sum(v for k, v in stats.items() if k != "raw")
    audit.tables[rows[0].member if rows else "empty"] = stats
    return kept


def csv_writer(path: Path, fields: list[str]):
    stream = path.open("w", newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    return stream, writer
