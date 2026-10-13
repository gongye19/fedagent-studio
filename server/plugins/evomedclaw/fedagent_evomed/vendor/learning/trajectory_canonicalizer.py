"""Canonicalize raw run logs into step-level trajectories."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

from fedagent_evomed.vendor.learning.trajectory_loader import load_scenario_artifacts
from fedagent_evomed.vendor.learning.types import CanonicalStep, CanonicalTrajectory, clone_route_decision

_SECTION_PATTERNS = {
    "positives": re.compile(
        r"Key Positive Findings:\s*(.*?)\s*(?:Key Negative Findings:|Tests Performed:|Working Differential:|Specific Question:|$)",
        re.DOTALL,
    ),
    "negatives": re.compile(
        r"Key Negative Findings:\s*(.*?)\s*(?:Tests Performed:|Working Differential:|Specific Question:|$)",
        re.DOTALL,
    ),
    "tests": re.compile(
        r"Tests Performed:\s*(.*?)\s*(?:Working Differential:|Specific Question:|$)",
        re.DOTALL,
    ),
}


def _extract_bullets(block: str) -> List[str]:
    items: List[str] = []
    for line in block.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("-"):
            line = line[1:].strip()
        items.append(line)
    return items


def _parse_consultation_summary(text: str) -> Tuple[List[str], List[str], List[str]]:
    positives = _extract_bullets(_match_section(text, "positives"))
    negatives = _extract_bullets(_match_section(text, "negatives"))
    tests = _extract_tests(_match_section(text, "tests"))
    return positives, negatives, tests


def _match_section(text: str, key: str) -> str:
    match = _SECTION_PATTERNS[key].search(text or "")
    return match.group(1).strip() if match else ""


def _extract_tests(block: str) -> List[str]:
    if not block:
        return []
    return [item.strip() for item in re.split(r",|\n", block) if item.strip()]


def _classify_local_doctor_action(text: str) -> Tuple[str, str]:
    if text.startswith("REQUEST TEST:"):
        return "request_test", text.split("REQUEST TEST:", 1)[1].strip()
    if text.startswith("REQUEST CONSULTATION:"):
        return "request_consultation", text
    if text.startswith("DIAGNOSIS READY:"):
        return "diagnosis_ready", text.split("DIAGNOSIS READY:", 1)[1].strip()
    return "ask_question", text


def _copy_list(values: Iterable[str]) -> List[str]:
    return list(values)


def canonicalize_scenario_directory(scenario_dir: str | Path) -> CanonicalTrajectory:
    """Load one scenario directory and return a canonical trajectory."""
    return canonicalize_artifacts(load_scenario_artifacts(scenario_dir))


def canonicalize_artifacts(artifacts) -> CanonicalTrajectory:
    """Adapter: same normalization with private persisted logs, without temporary raw files."""
    scenario_id = int(artifacts.scenario_result["scenario_id"])

    positives: List[str] = []
    negatives: List[str] = []
    tests: List[str] = []
    route_decision: Dict[str, Any] = {}
    steps: List[CanonicalStep] = []

    for event in artifacts.dialogue_history:
        speaker = event.get("speaker", "")
        text = str(event.get("text", "") or "")

        if speaker == "LocalDoctor":
            stage = str(event.get("stage") or "unknown")
            action_type, payload = _classify_local_doctor_action(text)
            if action_type == "request_test" and payload and payload not in tests:
                tests.append(payload)
            if action_type == "request_consultation":
                positives, negatives, consult_tests = _parse_consultation_summary(text)
                for item in consult_tests:
                    if item not in tests:
                        tests.append(item)
            steps.append(
                CanonicalStep(
                    scenario_id=scenario_id,
                    stage=stage,
                    role="local_doctor",
                    positives=_copy_list(positives),
                    negatives=_copy_list(negatives),
                    tests=_copy_list(tests),
                    route_decision=clone_route_decision(route_decision),
                    action_type=action_type,
                    action_payload=payload,
                    memory_entry_ids=list(event.get("memory_entry_ids") or []),
                )
            )
            continue

        if speaker == "HospitalRoute":
            try:
                route_decision = json.loads(text)
            except json.JSONDecodeError:
                route_decision = {}
            steps.append(
                CanonicalStep(
                    scenario_id=scenario_id,
                    stage="consult_route",
                    role="hospital_router",
                    positives=_copy_list(positives),
                    negatives=_copy_list(negatives),
                    tests=_copy_list(tests),
                    route_decision=clone_route_decision(route_decision),
                    action_type="route_decision",
                    action_payload=text,
                )
            )
            continue

        if speaker == "HospitalExpert":
            steps.append(
                CanonicalStep(
                    scenario_id=scenario_id,
                    stage="department_consult",
                    role="specialist",
                    positives=_copy_list(positives),
                    negatives=_copy_list(negatives),
                    tests=_copy_list(tests),
                    route_decision=clone_route_decision(route_decision),
                    action_type="hospital_opinion",
                    action_payload=text,
                )
            )

    final_outcome = dict(artifacts.scenario_result)
    if artifacts.consultation_history and not route_decision:
        final_outcome["route_decision"] = artifacts.consultation_history[0].get("route_decision", {})

    return CanonicalTrajectory(
        scenario_id=scenario_id,
        source_dir=str(artifacts.scenario_dir),
        steps=steps,
        final_outcome=final_outcome,
    )
