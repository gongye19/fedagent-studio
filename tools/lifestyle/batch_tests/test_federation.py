import importlib
import json
from collections import Counter

import pytest
from fedagent import models as m
from fedagent_fot import prompts
from fedagent_fot.fake import fake_reply
from fedagent_sdk import ChatResult, ModelError
from sqlalchemy import func, select

from tools.lifestyle.batch.federate import federate
from tools.lifestyle.common import digest, jsonl, load, save
from tools.lifestyle.runner import local_platform


class FakeModel:
    name = "test"
    budget_exhausted = False
    context_failure = None
    cache_hits = 0

    def __init__(self, failure=None):
        self.identity = {"model": "test"}
        self.requests = []
        self.failure = failure

    def chat(self, messages, **settings):
        if self.failure == "budget" and len(self.requests) >= 30:
            self.budget_exhausted = True
            raise ModelError("test generation call cap")
        self.requests.append(messages)
        text = messages if isinstance(messages, str) else "\n".join(m["content"] for m in messages)
        step = next(
            (
                step
                for step, key in [("reflect", "REFLECTION"), ("extract", "TRACE"), ("profile", "PROFILING"), ("library", "LIBRARY")]
                if text.lstrip().startswith(getattr(prompts, key + "_TEMPLATE").strip()[:70])
            ),
            None,
        )
        if step == self.failure:
            reply = "{}"
        elif step == "extract":
            if self.failure == "excess":
                reply = json.dumps({f"insight_{i}": "method" for i in range(4)})
            elif self.failure == "zero" and "NIH-01" in text:
                reply = "{}"
            else:
                reply = json.dumps({"insight_public" + digest(text)[:10]: "Confirm physical limitations before choosing an activity."})
        else:
            reply = fake_reply(step, text, digest(text)) if step else "OK"
        return ChatResult(reply or "OK", "test", {"prompt_tokens": 1, "completion_tokens": 1}, "stop")


def setup_run(tmp_path, model):
    records = {
        group: [
            {
                "id": f"{group}-{i:02d}",
                "input": {"profile": "公开资料，个人信息未知", "question": f"{group}-{i:02d}适合什么活动？"},
                "events": [{"role": "advisor", "content": "先确认活动限制。"}],
                "output": "按能力循序渐进。",
                "provenance": {"synthetic": True},
            }
            for i in range(1, 11)
        ]
        for group in ("NIH", "CDC", "NHS")
    }
    for group, values in records.items():
        jsonl(tmp_path / "upload" / (group + ".jsonl"), values)
    platform = local_platform(tmp_path, model)
    return {"fingerprint": "test-manifest"}, records, platform


def test_real_api_three_by_ten_without_extra_local_libraries(tmp_path, monkeypatch):
    def forbidden(*args):
        pytest.fail("old flow must never be used")

    monkeypatch.setattr("tools.lifestyle.runner.federate", forbidden)
    monkeypatch.setattr("tools.lifestyle.runner.local_libraries", forbidden)
    model = FakeModel()
    manifest, records, platform = setup_run(tmp_path, model)
    state, library = federate(tmp_path, manifest, records, platform, model)
    assert len(state["traceCoverage"]) == 30 and Counter(state["traceCoverage"].values()) == {1: 30} and library
    with platform.db.session() as session:
        assert list(session.scalars(select(m.Dataset.count).order_by(m.Dataset.name))) == [10, 10, 10]
        assert session.scalar(select(func.count()).select_from(m.App)) == 1
    assert len(model.requests) == 63  # one probe,60 reflect/extract,two global aggregation calls
    before = len(model.requests)
    assert federate(tmp_path, manifest, records, platform, model)[1] == library
    assert len(model.requests) == before and "local" not in state


@pytest.mark.parametrize("failure", ["profile", "library", "excess", "zero", "budget"])
def test_algorithm_failures_terminal_and_never_publish_or_rerun(tmp_path, failure):
    model = FakeModel(failure)
    manifest, records, platform = setup_run(tmp_path, model)
    with pytest.raises(ValueError, match="terminal-experiment"):
        federate(tmp_path, manifest, records, platform, model)
    state = load(tmp_path / "task.json")
    assert state["terminal"]
    before = len(model.requests)
    with pytest.raises(ValueError, match="terminal-experiment"):
        federate(tmp_path, manifest, records, platform, model)
    assert len(model.requests) == before
    with platform.db.session() as session:
        assert session.scalar(select(func.count()).select_from(m.App)) == 0


def test_budget_gate_precedes_answers_and_terminal_run_does_not_inspect_model(tmp_path, monkeypatch):
    main = importlib.import_module("tools.lifestyle.batch.__main__")
    manifest = {"modelRef": "test:test", "callLimit": 850, "evaluationReservation": 730, "operationalContextCap": 131072}
    model = FakeModel()
    model.limit = 850
    monkeypatch.setattr("tools.lifestyle.model.CachedModel", lambda *a, **kw: model)
    monkeypatch.setattr("tools.lifestyle.runner.local_platform", lambda *a: None)
    monkeypatch.setattr("tools.lifestyle.batch.generate.generate", lambda *a: {})
    monkeypatch.setattr("tools.lifestyle.batch.federate.federate", lambda *a: ({}, {"experience": "test"}))
    monkeypatch.setattr("tools.lifestyle.batch.evaluate.evaluate", lambda *a: pytest.fail("evaluation budget gate failed"))
    monkeypatch.setattr("tools.lifestyle.batch.report.report", lambda *a: {"run": load(tmp_path / "run.json")})
    save(tmp_path / "attempts.json", [{"status": "ok"}] * 121)
    first = main.run(tmp_path, manifest)
    assert first["run"]["terminal"] and "reserved-evaluation-budget" in first["run"]["error"]
    monkeypatch.setattr("tools.lifestyle.model.CachedModel", lambda *a, **kw: pytest.fail("terminal run inspected model"))
    assert main.run(tmp_path, manifest) == first
