import json

import pytest

from tools.lifestyle import model as bridge
from tools.lifestyle.batch_tests.test_federation import FakeModel
from tools.lifestyle.common import jsonl, load, save
from tools.lifestyle.sensor_trial import prepare as preparation
from tools.lifestyle.sensor_trial.adapter import TARGET
from tools.lifestyle.sensor_trial.prepare import file_hash, prepare

IDENTITY = {"endpoint": "default", "model": "test", "kind": "openai", "baseUrl": "https://example.test/v1"}


@pytest.fixture
def remote(monkeypatch):
    state = {"paid": 0, "inspect": 0, "requests": [], "invalid": 0, "outage": False, "truncated": 0}
    fake = FakeModel()

    def call(request):
        if request.get("inspect"):
            state["inspect"] += 1
            return IDENTITY
        state["paid"] += 1
        state["requests"].append(request)
        if state["outage"]:
            from fedagent_sdk import ModelError

            raise ModelError("test unknown cost connection failure")
        is_eval = request["messages"][0]["content"].startswith("CG_OBSERVATION_V1")
        if is_eval:
            if state["truncated"]:
                state["truncated"] -= 1
                return {"text": "incomplete", "model": "test", "usage": {"completion_tokens": 1}, "finish_reason": "length"}
            invalid = state["invalid"] > 0
            state["invalid"] -= invalid
            reply = "bad-format" if invalid else json.dumps({TARGET: 150.5, "explanation": "测试模型；不得作为真实结果"})
            return {"text": reply, "model": "test", "usage": {"prompt_tokens": 1, "completion_tokens": 1}, "finish_reason": "stop"}
        reply = fake.chat(request["messages"], **request["settings"])
        return {"text": reply.text, "model": reply.model, "usage": reply.usage, "finish_reason": reply.finish_reason}

    monkeypatch.setattr(bridge, "remote", call)
    return state


@pytest.fixture
def job(tmp_path, monkeypatch):
    source, out = tmp_path / "source", tmp_path / "trial"
    evals, refs, learned = [], [], {}
    for site_index, site in enumerate("ABC"):
        learned[site] = []
        for index in range(2):
            n = site_index * 2 + index
            public = {
                "profile": {"age_years": str(20 + n)},
                "logged_meal": {"type": "breakfast", "nutrition_estimates": {"kcal": str(100 + n)}},
                "prior_activity": {},
            }
            outcome = {
                TARGET: str(9000 + n),
                "baseline_mg_dl": "100",
                "peak_delta_mg_dl": "20",
                "primary_device": "dexcom_mg_dl",
                "boundary_censoring_possible": False,
            }
            learned[site].append(
                {
                    "id": f"learn-{n}",
                    "participant_id": f"train-person-{n}",
                    "site": site,
                    "input": public,
                    "observed_outcome": outcome,
                    "provenance": {},
                }
            )
            evals.append({"id": f"eval-{n}", "input": {**public, "profile": {"age_years": str(40 + n)}}})
            refs.append(
                {
                    "id": f"eval-{n}",
                    "participant_id": f"heldout-person-{n}",
                    "observed_outcome": {TARGET: str(123456 + n)},
                    "provenance": {"secret": "HELDOUT_REFERENCE_CANARY"},
                }
            )
        jsonl(source / f"learning/cgmacros/site-{site}.jsonl", learned[site])
    jsonl(source / "evaluation/cgmacros/inputs.jsonl", evals)
    jsonl(source / "references/cgmacros.jsonl", refs)
    save(
        source / "budget.json",
        {
            "proposals": {
                "cgmacros": {
                    "smoke": {
                        "learningSiteCounts": dict.fromkeys("ABC", 2),
                        "evaluationParticipants": 6,
                        "normalCallsTemplate": 27,
                        "batchAllocation": [[r["id"] for rs in learned.values() for r in rs]],
                        "learningIds": [r["id"] for rs in learned.values() for r in rs],
                        "evaluationIds": [r["id"] for r in evals],
                    }
                }
            }
        },
    )
    (source / "ATTRIBUTION.txt").write_text("Synthetic fixture; no real users")
    files = {str(p.relative_to(source)): {"bytes": p.stat().st_size, "sha256": file_hash(p)} for p in source.rglob("*") if p.is_file()}
    save(source / "manifest.json", {"version": "test-source", "files": files})
    save(source / "COMPLETE.json", {"version": "test-source", "manifestSha256": file_hash(source / "manifest.json")})
    monkeypatch.setattr(
        preparation, "SOURCE_POLICY", {"sourceVersion": "test-source", "sourceManifestSha256": file_hash(source / "manifest.json")}
    )
    plan = prepare(out, source, IDENTITY)
    assert load(out / "inputs/plan.json") == plan
    return out, source, plan
