"""并行执行保留提示词、专家顺序和隔离账本；不依赖真实模型。"""
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import httpx
import pytest
from fedagent_evomed.bridge import current_bridge, use_model
from fedagent_evomed.parallel import ParallelSpecialists
from fedagent_evomed.vendor.runtime.department_first.core.specialist_agent import DepartmentSpecialistService
from fedagent_sdk import ChatResult, ModelUnavailable
from sqlalchemy import select

from fedagent import models as m
from fedagent.gateway import LedgerKey
from fedagent.model_runtime import GatewayModel


class Scoped:
    name = "model"

    def fork(self, scope):
        return Scoped()

    def chat(self, prompt, **kwargs):
        return ChatResult(str(prompt), self.name, {"prompt_tokens": 1, "completion_tokens": 2})


def test_independent_experts_overlap_but_keep_original_prompts_and_consensus_order(monkeypatch):
    service = object.__new__(ParallelSpecialists)
    barrier = threading.Barrier(3, timeout=5)
    calls = []
    lock = threading.Lock()
    active, peak = 0, 0
    parallel = True

    def specialist(**kw):
        nonlocal active, peak
        with lock:
            calls.append(kw)
            active += 1
            peak = max(peak, active)
        if parallel:
            barrier.wait()
        bridge = current_bridge()
        value = bridge.query(kw["prompt"], kw["system_prompt"], 100)
        with lock:
            active -= 1
        return value

    monkeypatch.setattr(service, "_expert_models_for_department", lambda _: ["one", "two", "three"])
    monkeypatch.setattr(service, "_consensus_model_for_department", lambda _: "consensus")
    monkeypatch.setattr(service, "_query_specialist", specialist)
    monkeypatch.setattr(service, "_query_department_consensus", lambda **kw: "|".join(kw["expert_opinions"]))
    args = ("case prompt", "system", "neurology", "case", 1)
    with use_model(Scoped()) as bridge:
        result = service._query_department_panel(*args)
    first = sorted(calls, key=lambda k: k["expert_index"])
    assert peak == 3
    assert bridge.usage == {"prompt_tokens": 3, "completion_tokens": 6}
    calls.clear()
    parallel = False
    with use_model(Scoped()):
        original = DepartmentSpecialistService._query_department_panel(service, *args)
    assert result == original
    assert first == calls


def test_parallel_lanes_replay_independently_of_completion_order(platform):
    ledger = LedgerKey("scoped-test", "site", 2, "learn", "case")
    root = platform.gateway.model("fake:fake", ledger=ledger)
    with ThreadPoolExecutor(3) as pool:
        replies = list(pool.map(lambda i: root.fork(f"expert-{i}").chat("same input"), range(3)))
    assert all(not reply.cached for reply in replies)
    for i in reversed(range(3)):
        assert platform.gateway.model("fake:fake", ledger=ledger).fork(f"expert-{i}").chat("same input").cached
    assert not root.fork("expert-0").chat("changed input").cached
    with platform.db.session() as db:
        rows = list(db.scalars(select(m.CallRecord).where(m.CallRecord.task_id == "scoped-test")))
    assert len(rows) == 4 and len({r.unit_key for r in rows}) == 3
    assert all(r.status == "ok" for r in rows)


def reply():
    return httpx.Response(200, json={"model": "fake", "choices": [{"message": {"content": "OK"}, "finish_reason": "stop"}],
                                     "usage": {"prompt_tokens": 1, "completion_tokens": 1}})


def test_parallel_branches_still_obey_shared_model_slot_limit(platform):
    barrier = threading.Barrier(2, timeout=5)
    lock = threading.Lock()
    active, peak = 0, 0
    def respond(request):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        barrier.wait()
        with lock:
            active -= 1
        return reply()
    platform.gateway._transport = httpx.MockTransport(respond)
    endpoint = replace(platform.gateway.endpoint("fake"), kind="openai", base_url="https://local.test/v1", concurrency=2, max_retries=0)
    model = GatewayModel(platform.gateway, endpoint, "fake", ledger=LedgerKey("slots", "s", 1, "step", "case"), purpose="task", plugin=None, step_id=None)
    with ThreadPoolExecutor(6) as pool:
        results = list(pool.map(lambda i: model.fork(str(i)).chat("hello"), range(6)))
    assert len(results) == 6 and peak == 2


def test_model_read_timeout_keeps_successful_prefix_for_exact_replay(platform):
    import json
    calls = []
    unavailable = [True]
    def respond(request):
        content = json.loads(request.content)["messages"][0]["content"]
        calls.append(content)
        if content == "second" and unavailable[0]:
            raise httpx.ReadTimeout("local timeout", request=request)
        return reply()
    platform.gateway._transport = httpx.MockTransport(respond)
    endpoint = replace(platform.gateway.endpoint("fake"), kind="openai", base_url="https://local.test/v1", max_retries=0)
    def model():
        return GatewayModel(platform.gateway, endpoint, "fake", ledger=LedgerKey("partial", "s", 1, "step", "case"), purpose="task", plugin=None, step_id=None)
    first = model()
    first.chat("first")
    with pytest.raises(ModelUnavailable):
        first.chat("second")
    unavailable[0] = False
    resumed = model()
    assert resumed.chat("first").cached
    assert not resumed.chat("second").cached
    assert calls == ["first", "second", "second"]
