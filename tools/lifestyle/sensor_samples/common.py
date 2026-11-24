"""Read-only verified inputs and deterministic numeric/provenance primitives."""

import hashlib
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath

from tools.lifestyle.sensors.archives import digest
from tools.lifestyle.sensors.common import dump, emit, scaled

__all__ = [
    "digest",
    "dump",
    "emit",
    "load_jsonl",
    "number",
    "rounded",
    "sample_id",
    "verify_input",
]


def number(value):
    if value is None or not str(value).strip():
        return None
    try:
        parsed = Decimal(str(value))
        return parsed if parsed.is_finite() else None
    except InvalidOperation:
        return None


def rounded(value):
    return scaled(str(value), "1") if value is not None else None


def load_jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def sample_id(domain, participant, anchor):
    return (
        domain
        + "-"
        + hashlib.sha256(
            f"sensor-case-v1|{domain}|{participant}|{anchor}".encode()
        ).hexdigest()[:24]
    )


def verify_input(root: Path, policy):
    manifest = json.loads((root / "manifest.json").read_text())
    complete = json.loads((root / "COMPLETE.json").read_text())
    if (
        complete["version"] != manifest["version"]
        or manifest["version"] != policy["sourceVersion"]
    ):
        raise ValueError("unexpected prepared source version")
    if (
        digest(root / "manifest.json") != complete["manifestSha256"]
        or complete["manifestSha256"] != policy["sourceManifestSha256"]
    ):
        raise ValueError("prepared manifest checksum mismatch")
    expected = set(manifest["files"]) | {"manifest.json", "COMPLETE.json"}
    actual = {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()}
    if actual != expected or any(p.is_symlink() for p in root.rglob("*")):
        raise ValueError("prepared source file set differs from manifest")
    for name, info in manifest["files"].items():
        relative = PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts or "\\" in name:
            raise ValueError("unsafe source path")
        path = root / name
        if path.stat().st_size != info["bytes"] or digest(path) != info["sha256"]:
            raise ValueError(f"prepared source file checksum mismatch: {name}")
    return manifest
