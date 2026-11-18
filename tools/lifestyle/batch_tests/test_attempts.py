import importlib

import pytest

from tools.lifestyle.batch.calls import UnitExhausted, obtain
from tools.lifestyle.common import digest, load, save
from tools.lifestyle.model import CachedModel


@pytest.mark.parametrize("reason", ["length", "empty"])
def test_completed_invalid_replies_are_bounded_across_new_model_instances(tmp_path, monkeypatch, reason):
    dispatched = []

    def remote(body):
        if body.get("inspect"):
            return {"endpoint": "test", "model": "test", "kind": "openai", "baseUrl": "https://test.invalid"}
        dispatched.append(body)
        return {"text": "partial" if reason == "length" else "", "model": "test", "finish_reason": "length" if reason == "length" else "stop", "usage": {}}

    monkeypatch.setattr("tools.lifestyle.model.remote", remote)
    path = tmp_path / "unit.json"
    for _ in range(2):
        model = CachedModel(tmp_path, "test:test")
        with pytest.raises(UnitExhausted):
            obtain(path, {}, model, [{"role": "user", "content": "one"}], {"max_tokens": 1024}, lambda text: text)
    assert len(dispatched) == 2 and len(load(path)["failures"]) == 2 and len(load(tmp_path / "attempts.json")) == 2


@pytest.mark.parametrize("stop", [None, "budget", "context"])
def test_eval_stop_is_terminal_and_successful_resume_clears_old_error(tmp_path, monkeypatch, stop):
    main = importlib.import_module("tools.lifestyle.batch.__main__")
    from .test_federation import FakeModel

    model = FakeModel()
    model.limit = 850
    save(tmp_path / "run.json", {"status": "incomplete", "evaluationStarted": True, "error": "stale error"})
    save(tmp_path / "shared-library.json", {"entry": "text"})
    save(tmp_path / "task.json", {"libraryDigest": digest({"entry": "text"})})
    monkeypatch.setattr("tools.lifestyle.model.CachedModel", lambda *a, **kw: model)

    def evaluate(*args):
        model.budget_exhausted = stop == "budget"
        model.context_failure = {} if stop == "context" else None
        if stop == "context":
            model.context_failure = {"stopped": True}
        return [
            {
                "rubrics": [],
                "permanentMissing": stop == "context",
                "arms": {a: {"status": "missing" if stop else "complete", "score": None if stop else 1, "grades": []} for a in ("without", "shared")},
            }
        ]

    monkeypatch.setattr("tools.lifestyle.batch.evaluate.evaluate", evaluate)
    monkeypatch.setattr("tools.lifestyle.batch.report.report", lambda *a: {"run": load(tmp_path / "run.json")})
    manifest = {"modelRef": "test:test", "callLimit": 850, "evaluationReservation": 730, "operationalContextCap": 131072}
    result = main.run(tmp_path, manifest)["run"]
    if stop:
        assert result["terminal"] and result["error"] != "stale error"
        monkeypatch.setattr("tools.lifestyle.model.CachedModel", lambda *a, **kw: pytest.fail("terminal resume tried model"))
        assert main.run(tmp_path, manifest)["run"] == result
    else:
        assert result["status"] == "complete" and "error" not in result


@pytest.mark.parametrize("permanent_failure", ["format", "context", "cache"])
def test_one_permanent_case_does_not_block_another_case_transport_resume(tmp_path, monkeypatch, permanent_failure):
    import json

    from fedagent_sdk import ChatResult, ModelError

    from tools.lifestyle.common import jsonl
    from tools.lifestyle.model import NotDispatchedPermanent

    from .test_federation import FakeModel

    main = importlib.import_module("tools.lifestyle.batch.__main__")
    inputs = tmp_path / "inputs"
    inputs.mkdir()
    cases = [{"id": key, "question": key, "messages": [{"role": "user", "content": key}]} for key in ("permanent-case", "transport-case")]
    jsonl(inputs / "evaluation-inputs.jsonl", cases)
    jsonl(inputs / "evaluation-references.jsonl", [{"id": c["id"], "rubrics": [{"points": 1, "criterion": "RULE"}]} for c in cases])
    (inputs / "grader-source.py").write_text('GRADER_TEMPLATE = """GRADER <<conversation>> <<rubric_item>>""".strip()')
    save(tmp_path / "run.json", {"status": "incomplete", "evaluationStarted": True})
    library = {"entry": "guide"}
    save(tmp_path / "shared-library.json", library)
    save(tmp_path / "task.json", {"libraryDigest": digest(library)})
    model = FakeModel()
    model.limit = 850
    requests = []
    transport_failed = False

    def chat(messages, **settings):
        nonlocal transport_failed
        text = messages[0]["content"]
        if not text.startswith("LIFESTYLE_COMPARISON_V1") and "permanent-case" in text and permanent_failure != "format":
            if permanent_failure == "context":
                model.context_failure = {"stopped": True}
            raise NotDispatchedPermanent("test context or cache rejection before dispatch")
        requests.append(text)
        if text.startswith("LIFESTYLE_COMPARISON_V1"):
            return ChatResult("valid answer", "test")
        if "permanent-case" in text:
            return ChatResult("bad json", "test")
        if not transport_failed:
            transport_failed = True
            raise ModelError("temporary failure before dispatch")
        return ChatResult(json.dumps({"criteria_met": True, "explanation": "OK"}), "test")

    model.chat = chat
    model.reject_last = lambda: None
    monkeypatch.setattr("tools.lifestyle.model.CachedModel", lambda *a, **kw: model)
    monkeypatch.setattr("tools.lifestyle.batch.report.report", lambda *a: {"run": load(tmp_path / "run.json")})
    manifest = {"fingerprint": "fixed", "modelRef": "test:test", "callLimit": 850, "evaluationReservation": 730, "operationalContextCap": 131072}
    first = main.run(tmp_path, manifest)["run"]
    assert first["status"] == "incomplete" and not first.get("terminal")
    permanent_calls = sum("permanent-case" in text for text in requests)
    second = main.run(tmp_path, manifest)["run"]
    assert second["terminal"] and sum("permanent-case" in text for text in requests) == permanent_calls
    recovered = load(tmp_path / "evaluation/transport-case.json")
    assert all(x["status"] == "complete" for x in recovered["arms"].values())
