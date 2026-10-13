"""Load existing EvoMed / department-first run artifacts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from fedagent_evomed.vendor.learning.types import RawScenarioArtifacts


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _read_json_list(path: Path) -> List[Dict[str, Any]]:
    payload = _read_json(path)
    if not isinstance(payload, list):
        raise ValueError(f"Expected a JSON list at {path}")
    return payload


def load_scenario_artifacts(scenario_dir: str | Path) -> RawScenarioArtifacts:
    """Load raw logs from one scenario directory."""
    root = Path(scenario_dir)
    scenario_result = _read_json(root / "scenario_result.json")
    dialogue_history = _read_json_list(root / "dialogue_history.json")

    consultation_path = root / "consultation_history.json"
    consultation_history: List[Dict[str, Any]] = []
    if consultation_path.exists():
        consultation_history = _read_json_list(consultation_path)

    return RawScenarioArtifacts(
        scenario_dir=root,
        scenario_result=scenario_result,
        dialogue_history=dialogue_history,
        consultation_history=consultation_history,
    )
