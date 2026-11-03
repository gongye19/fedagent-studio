"""公开过程独立于最终结果：实时读取、续传、边界隔离和观察透明性。"""
import sqlite3
from threading import Event, Thread
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from fedagent_evomed.bridge import diagnose
from fedagent_evomed.progress import Trace
from fedagent_sdk import ProgressUpdate
from test_agents import fot_config
from test_medical import cases

from fedagent.agents.progress import ProgressStore
from fedagent.agents.progress_collector import ProgressCollector
from fedagent.agents.protocol import AgentRequest
from fedagent.agents.service import create_agent_app
from fedagent.task_services.process import append


def make_task(client):
    response = client.post("/v1/tasks", json=fot_config(client))
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_process_pagination_filters_and_refresh(platform, client):
    task = make_task(client)
    for seq in range(1, 104):
        append(platform, task_id=task, origin="one", seq=seq, site="p-a" if seq % 2 else "p-b", round=1, step="solve", unit="x",
               event=ProgressUpdate(activity=str(seq), title="动作", status="completed"))
    first = client.get(f"/v1/tasks/{task}/process").json()
    assert len(first["events"]) == 100 and first["hasMore"]
    second = client.get(f"/v1/tasks/{task}/process?after={first['after']}").json()
    assert len(second["events"]) == 3 and not second["hasMore"]
    assert {e["id"] for e in first["events"]}.isdisjoint(e["id"] for e in second["events"])
    filtered = client.get(f"/v1/tasks/{task}/process?round=1&site=p-a").json()
    assert len(filtered["events"]) == 52 and all(e["site"] == "p-a" for e in filtered["events"])
    assert client.get(f"/v1/tasks/{task}/process?round=2").json()["events"] == []
    assert client.get(f"/v1/tasks/{task}/process").json() == first
    assert client.get('/v1/tasks/missing/process').status_code == 404
    assert not any(e["kind"] == "process" for e in client.get(f"/v1/tasks/{task}/events").json())


def test_provider_events_available_before_final_result(platform, tmp_path):
    root = tmp_path / "provider"
    app = create_agent_app(platform, root, "fake:fake", token="local-test-only")
    path = root / "runs.sqlite"
    with sqlite3.connect(path) as db:
        db.execute('INSERT INTO runs VALUES(?,?,?)', ('one', 'digest', '{"run_id":"one","status":"running"}'))
    entered, release = Event(), Event()
    def work():
        ProgressStore(path).append("one", ProgressUpdate(activity="visit", title="问诊", status="running"))
        entered.set()
        assert release.wait(5)
        ProgressStore(path).append("one", ProgressUpdate(activity="visit", title="问诊", status="completed"))
    thread = Thread(target=work)
    thread.start()
    try:
        assert entered.wait(5)
        with TestClient(app) as service:
            assert service.get('/runs/one/events').status_code == 401
            headers = {"Authorization": "Bearer local-test-only"}
            assert service.get('/runs/one', headers=headers).json()["status"] == "running"
            first = service.get('/runs/one/events', headers=headers).json()
            assert [e["status"] for e in first["events"]] == ["running"]
            release.set()
            thread.join(5)
            final = service.get('/runs/one/events?after=1', headers=headers).json()
            assert [e["status"] for e in final["events"]] == ["completed"]
            assert service.get('/runs/other/events', headers=headers).status_code == 404
    finally:
        release.set()
        thread.join(5)
    assert len(ProgressStore(path).page("one", 0).events) == 2


def test_collector_optional_replay_cursor_and_item_boundary(platform, client):
    task = make_task(client)
    request = AgentRequest(run_id="public-run", algorithm="fot", version=platform.registry.algorithm("fot").version, task_type="math-reasoning", task_id=task,
                           site_id="p-a", role="participant", round=1, rounds=2, step="solve", unit_key="x")
    class Gateway:
        def request(self, *args):
            return {"events": [dict(activity="doctor", title="医生", status="running", seq=1)]}
    gateway = Gateway()
    collector = ProgressCollector(platform, gateway, "a", request, 1)
    collector.pull(False)
    assert client.get(f"/v1/tasks/{task}/process").json()["events"] == []
    collector.pull(True)
    assert ProgressCollector(platform, gateway, "a", request, 1).after == 1
    assert len(client.get(f"/v1/tasks/{task}/process").json()["events"]) == 1
    gateway.request = lambda *a: {"events": [dict(activity="bad", title="bad", status="running", seq=1, item_id="unauthorized")]}
    collector = ProgressCollector(platform, gateway, "a", request.model_copy(update={"run_id": "bad"}), 1)
    collector.pull(True)
    rows = client.get(f"/v1/tasks/{task}/process").json()["events"]
    assert rows[-1]["event"]["activity"] == "progress-unavailable"
    assert "unauthorized" not in str(rows)
    assert ProgressCollector(platform, gateway, "a", request.model_copy(update={"run_id": "bad"}), 1).after == 0


def test_medical_observer_preserves_diagnosis_and_label_boundary(platform):
    algorithm = platform.registry.algorithm("evomedclaw")
    model = platform.gateway.model("fake:fake", plugin=algorithm, step_id="diagnose")
    case = {**cases()[0], "answer": "REFERENCE-CANARY-NEVER-PUBLISH"}
    original, _ = diagnose(case, None, model, turns=4)
    events = []
    observed, _ = diagnose(case, None, model, turns=4, item_id="case-1", progress=lambda *a, **kw: events.append((a, kw)))
    for key in ("predicted_diagnosis", "dialogue_history", "consultation_history", "num_turns", "num_tests", "num_consultations"):
        assert observed[key] == original[key]
    assert any(e[0][1] == "医生问诊" and e[0][2] == "running" for e in events)
    assert events[-1][0][1] == "诊断完成" and "REFERENCE-CANARY" not in str(events)
    assert all(e[1]["item_id"] == "case-1" for e in events)


def test_nested_observer_preserves_results_exceptions_and_hides_reasoning():
    events = []
    trace = Trace(lambda *a, **kw: events.append((a, kw)), "case-1")
    sentinel = SimpleNamespace(value="same")
    child = SimpleNamespace(call=lambda: sentinel)
    parent = SimpleNamespace(call=lambda: child.call())
    trace.observe(child, "call", "专家意见", lambda v: ("原结果", "<think>PRIVATE-REASONING</think>公开意见"))
    trace.observe(parent, "call", "会诊", lambda v: ("完成", ""))
    assert parent.call() is sentinel
    assert events[1][1]["parent"] == events[0][0][0]
    assert "PRIVATE-REASONING" not in str(events)
    child.call = lambda: (_ for _ in ()).throw(RuntimeError("PRIVATE-ERROR"))
    trace.observe(child, "call", "检查")
    with pytest.raises(RuntimeError, match="PRIVATE-ERROR"):
        child.call()
    assert events[-1][0][2] == "failed" and "PRIVATE-ERROR" not in str(events)


def test_observation_storage_failure_never_changes_algorithm_result():
    trace = Trace(lambda *a, **kw: (_ for _ in ()).throw(OSError("disk error")), "case")
    doctor = SimpleNamespace(call=lambda: "original")
    trace.observe(doctor, "call", "问诊")
    assert doctor.call() == "original"
