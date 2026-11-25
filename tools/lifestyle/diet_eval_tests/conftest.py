import json

import pytest
from fedagent_sdk import ModelError

from tools.lifestyle import model as bridge
from tools.lifestyle.common import digest, jsonl, save
from tools.lifestyle.diet_eval import prepare as preparation
from tools.lifestyle.diet_eval.audit import POLICY
from tools.lifestyle.diet_eval.specs import CASES, LIBRARY_RUN, OLD_EVAL, SOURCE
from tools.lifestyle.diet_transport import CompletedUpstreamError

IDENTITY = {"endpoint": "default", "model": "test", "kind": "openai", "baseUrl": "https://example.test/v1"}


@pytest.fixture
def job(tmp_path, monkeypatch):
    monkeypatch.setattr(preparation, "ROOT", tmp_path)
    monkeypatch.setattr(preparation, "implementation", lambda: {"files": {"new-eval": "fixed"}})
    monkeypatch.setattr(preparation, "protected_files", lambda *args: {})
    source, old = tmp_path / SOURCE, tmp_path / LIBRARY_RUN
    cases, refs = [], []
    for i, spec in enumerate(CASES):
        key = "healthbench:" + spec["id"]
        negative = {v for d in spec["dimensions"].values() for v in d["neg"]} | set(spec["critical"])
        cases.append(
            {"id": key, "messages": [{"role": "user", "content": f"fixture {i}: " + " | ".join(v[1] for v in spec["facts"].values())}]}
        )
        refs.append(
            {
                "id": key,
                "rubrics": [
                    {"criterion": f"REFERENCE_ONLY_CANARY rule {j}", "points": -5 if f"r{j}" in negative else 5, "tags": []}
                    for j in range(14)
                ],
            }
        )
    jsonl(source / "evaluation-inputs.jsonl", cases)
    jsonl(source / "evaluation-references.jsonl", refs)
    save(source / "manifest.json", {"fixture": True})
    jsonl(tmp_path / OLD_EVAL, [{"id": "healthbench:previously-used"}])
    library = {"insight_" + k: "Candidate strategy " + k for k in POLICY}
    save(old / "batch-01/library.json", library)
    save(old / "batch-01/state.json", {"libraryDigest": digest(library)})
    report = {"status": "complete", "finalEntries": 10}
    save(old / "report.json", report)
    save(old / "COMPLETE.json", {"reportDigest": digest(report)})
    save(old / "inputs/plan.json", {"identity": IDENTITY, "modelRef": "default:test"})
    jsonl(
        old / "inputs/evaluation.jsonl",
        [
            {
                "id": "old-development",
                "input": {"profile": {"fasting_glucose_mg_dl": "120"}, "logged_meal": {"nutrition_estimates": {"fiber_g": "0"}}},
            }
        ],
    )
    directory = tmp_path / "data/lifestyle-prep/case-eval/test"
    return directory, preparation.prepare(directory)


@pytest.fixture
def remote(monkeypatch):
    state = {"paid": 0, "inspect": 0, "requests": [], "overloads": 0, "invalid": 0, "unknown": False, "badCalibration": False}

    def request(body):
        if body.get("inspect"):
            state["inspect"] += 1
            return IDENTITY
        state["paid"] += 1
        state["requests"].append(body)
        if state["unknown"]:
            raise ModelError("test unknown-cost error")
        if state["overloads"]:
            state["overloads"] -= 1
            error = CompletedUpstreamError("test completed overload")
            error.overloaded = True
            raise error
        if state["invalid"]:
            state["invalid"] -= 1
            text = "invalid-json"
        elif body["messages"][0]["content"].startswith("Evaluate two anonymous"):
            value = json.loads(body["messages"][1]["content"])
            conversation = "\n".join(m["content"] for m in value["conversation"])
            result = {"differences": ["Different concrete recommendations in fixture"]}
            calibration = "Is any peanut snack safe" in conversation
            for label in ("X", "Y"):
                if calibration:
                    flags = {key: (key == "r3") if label == "X" or state["badCalibration"] else key != "r3" for key in value["rules"]}
                else:
                    spec = CASES[int(conversation.split("fixture ", 1)[1][0])]
                    negative = {v for d in spec["dimensions"].values() for v in d["neg"]} | set(spec["critical"])
                    flags = {key: key not in negative for key in value["rules"]}
                    if value["answers"][label].startswith("BASELINE"):
                        flags[spec["dimensions"]["decision"]["pos"][0]] = False
                result[label] = {
                    "rules": flags,
                    "coreRecommendations": [value["answers"][label][:100]],
                    "reason": "fixture grounded reason",
                }
            text = json.dumps(result)
        elif body["messages"][0]["content"].startswith("You are a lifestyle"):
            assert "REFERENCE_ONLY_CANARY" not in json.dumps(body["messages"])
            memory = json.loads(body["messages"][1]["content"].split("\n", 1)[1])
            text = ("SHARED" if memory else "BASELINE") + " useful answer: " + body["messages"][-1]["content"]
        else:
            text = "OK"
        return {"text": text, "model": "test", "finish_reason": "stop", "usage": {"prompt_tokens": 1, "completion_tokens": 1}}

    monkeypatch.setattr(bridge, "remote", request)
    return state
