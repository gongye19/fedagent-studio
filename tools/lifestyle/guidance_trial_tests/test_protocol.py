"""来源保留、聚合覆盖、参考隔离、额度与缓存的离线回归。"""

import json
from types import SimpleNamespace

import pytest

from tools.lifestyle.common import load
from tools.lifestyle.guidance_trial.calls import Calls
from tools.lifestyle.guidance_trial.prepare import prepare, validate
from tools.lifestyle.guidance_trial.protocol import parse_cards, parse_groups, retrieve
from tools.lifestyle.guidance_trial.transport import GuidanceLink
from tools.lifestyle.model import CachedModel


def card():
    return {
        "title": "Walking",
        "applies_to": "Adults",
        "action": "Walk regularly",
        "parameters": "Not specified",
        "limits": "Adapt to ability",
        "quotes": ["Walking is an example activity."],
    }


def test_exact_source_evidence_and_card_limit():
    row = {"fullArticleText": "Walking is an example activity."}
    assert parse_cards(json.dumps({"trace_walk": card()}), row)["trace_walk"] == card()
    altered = card()
    altered["quotes"] = ["Walking cures every disease."]
    with pytest.raises(ValueError, match="evidence"):
        parse_cards(json.dumps({"trace_walk": altered}), row)
    with pytest.raises(ValueError, match="one-to-three"):
        parse_cards(json.dumps({f"trace_{i}": card() for i in range(4)}), row)


@pytest.mark.parametrize("members", [["a"], ["a", "b", "b"], ["a", "c"]])
def test_aggregation_cannot_drop_duplicate_or_invent_cards(members):
    with pytest.raises(ValueError, match="missing-duplicate-or-unknown"):
        parse_groups(
            json.dumps({"groups": [{"name": "group", "members": members}]}),
            {"a": "A", "b": "B"},
        )


def test_reference_aggregation_and_question_only_retrieval():
    store = {"a": "A", "b": "B"}
    groups = parse_groups(
        json.dumps({"groups": [{"name": "group", "members": ["a", "b"]}]}), store
    )
    assert groups[0]["members"] == ["a", "b"]
    cards = {str(i): {"card": card(), "sourceId": str(i)} for i in range(20)}
    chosen, audit = retrieve([{"role": "user", "content": "walking activity"}], cards)
    assert len(chosen) == 8 and audit["characters"] <= 18000
    assert (
        chosen == retrieve([{"role": "user", "content": "walking activity"}], cards)[0]
    )
    assert retrieve([{"role": "user", "content": "unrelatedxyz"}], cards)[0] == {}
    groups = [{"id": "one-group", "name": "merged walking", "members": list(cards)}]
    selected, _ = retrieve(
        [{"role": "user", "content": "walking"}], cards, groups=groups
    )
    assert (
        len(selected) == 1
    )  # Aggregation actually changes selection, not display-only metadata.


IDENTITY = {
    "endpoint": "test",
    "model": "test",
    "kind": "openai",
    "baseUrl": "http://test.invalid",
}


class Fake(CachedModel):
    requests = 0

    def _request(self, request):
        if request.get("inspect"):
            return IDENTITY
        Fake.requests += 1
        return {
            "text": "answer",
            "model": "test",
            "usage": {"prompt_tokens": 1},
            "finish_reason": "stop",
        }


def make_calls(tmp_path, cap=1):
    plan = {
        "identity": IDENTITY,
        "modelRef": "test:test",
        "fingerprint": "fixed",
        "namespaces": ["meter-a", "meter-b"],
        "evaluationCap": 10,
        "batchCap": 10,
        "contextCap": 131072,
        "globalCallCap": cap,
    }
    calls = Calls(tmp_path, plan, None)
    calls.factory = Fake
    return calls


def test_global_budget_across_namespaces_and_zero_call_cached_resume(tmp_path):
    Fake.requests = 0
    calls = make_calls(tmp_path)
    assert (
        calls.one("meter-a", "unit.json", "question", {"max_tokens": 10}, str.strip)
        == "answer"
    )
    assert Fake.requests == 1
    resumed = make_calls(tmp_path)
    assert (
        resumed.one("meter-a", "unit.json", "question", {"max_tokens": 10}, str.strip)
        == "answer"
    )
    assert Fake.requests == 1
    with pytest.raises(ValueError, match="global-budget"):
        resumed.one("meter-b", "other.json", "other", {"max_tokens": 10}, str.strip)
    with pytest.raises(ValueError, match="unit-cache-mismatch"):
        resumed.one(
            "meter-a",
            "unit.json",
            "question",
            {"max_tokens": 10},
            lambda text: text + "changed",
        )
    assert Fake.requests == 1


def test_unknown_dispatch_cannot_be_retried(tmp_path):
    calls = make_calls(tmp_path)
    calls.one("meter-a", "unit.json", "question", {"max_tokens": 10}, str.strip)
    path = tmp_path / "meter-a/attempts.json"
    values = load(path)
    values[0]["status"] = "started"
    path.write_text(json.dumps(values))
    with pytest.raises(ValueError, match="unconfirmed"):
        make_calls(tmp_path)


def test_identity_wait_does_not_change_paid_request_path(tmp_path, monkeypatch):
    link = GuidanceLink(tmp_path)
    link.base = ["ssh-test"]
    monkeypatch.setattr(link, "check", lambda: None)
    inspections = []

    def inspect(*args, **kwargs):
        inspections.append(kwargs["timeout"])
        return SimpleNamespace(stdout=json.dumps(IDENTITY))

    monkeypatch.setattr(
        "tools.lifestyle.guidance_trial.transport.subprocess.run", inspect
    )
    monkeypatch.setattr(
        "tools.lifestyle.diet_transport.DietLink.request",
        lambda self, request: {"paid": request},
    )
    assert link.request({"ref": "test:test", "inspect": True}) == IDENTITY
    assert link.request({"ref": "test:test", "inspect": True}) == IDENTITY
    assert inspections == [60]
    assert link.request({"ref": "test:test", "messages": []}) == {
        "paid": {"ref": "test:test", "messages": []}
    }


def test_prepare_only_four_sources_all_records_unused_evaluation_and_tamper(tmp_path):
    directory = tmp_path / "run"
    plan = prepare(directory, IDENTITY)
    assert sum(plan["counts"].values()) == 345
    assert plan["normalCalls"] == 1312
    assert len(plan["batchIds"]) == 29
    assert set(plan["evaluationIds"]).isdisjoint(plan["excludedOldEvaluationIds"])
    assert validate(directory) == plan
    path = directory / "inputs/sources.jsonl"
    path.write_text(path.read_text().replace("Food and nutrition", "Edited", 1))
    with pytest.raises(ValueError, match="sources-changed"):
        validate(directory)
