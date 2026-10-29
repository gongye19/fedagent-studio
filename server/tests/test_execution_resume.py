"""调度超时与坏输出分开，已完成病例不重跑，真实并发有上限。"""
import threading

import pytest
from intake_helpers import verify_resources
from sqlalchemy import select
from test_api import config as math_config
from test_medical import cases, medical_agents, medical_config, raw

from fedagent import models as m
from fedagent.agents.gateway import AgentGateway, AgentPending
from fedagent.agents.protocol import AgentRequest
from fedagent.engine import TaskEngine
from fedagent.gateway import LedgerKey
from fedagent.unit_executor import Outcome, fail_unit


def make_medical(client, remote):
    rows = [*cases(), {**cases()[0], "id": "second-learn", "patient": "Separate learning patient with migraine."}]
    selected = []
    for pid in ("p-a", "p-b"):
        data = client.post('/v1/datasets', data={'participantId': pid, 'name': 'local test', 'taskType': 'medical-diagnosis', 'scenario': 'horizontal'},
                           files={'file': ('d.jsonl', raw(rows))})
        assert data.status_code == 201, data.text
        selected.append({"participantId": pid, "datasetId": data.json()["id"]})
    config = medical_config(selected)
    config.update(execution="agent", agentId=remote[0], trialCap=3, workers=4)
    medical_agents(client, config, remote[0])
    verify_resources(client, config)
    config["checkId"] = client.post('/v1/task-checks', json=config).json()["id"]
    return client.post('/v1/tasks', json=config).json()["id"]


def test_completed_cases_survive_lost_response_and_compile_only_once(platform, client, remote, monkeypatch):
    task = make_medical(client, remote)
    original = AgentGateway.execute
    lost = []
    first_done = threading.Event()

    def lossy(self, agent, body, **kw):
        if body.task_id == task and body.step == "learn" and body.site_id == "p-a" and body.unit_key == "second-learn":
            assert first_done.wait(5)
            result = original(self, agent, body, **kw)
            if not lost:
                lost.append(body.unit_key)
                raise AgentPending("lost response after execution")
            return result
        result = original(self, agent, body, **kw)
        if body.task_id == task and body.step == "learn" and body.site_id == "p-a" and body.unit_key == "learn-private":
            first_done.set()
        return result

    monkeypatch.setattr(AgentGateway, "execute", lossy)
    with platform.db.session() as db:
        db.get(m.Task, task).status = "running"
    assert TaskEngine(platform, task, poll=.01).run() == "paused"
    with platform.db.session() as db:
        done = db.scalar(select(m.WorkUnit).where(m.WorkUnit.task_id == task, m.WorkUnit.step == "learn",
                                                m.WorkUnit.site_id == "p-a", m.WorkUnit.unit_key == "learn-private"))
        assert done.status == "done"
        assert not list(db.scalars(select(m.CallRecord).where(m.CallRecord.task_id == task, m.CallRecord.status == "discarded")))
        db.get(m.Task, task).status = "running"
    assert TaskEngine(platform, task, poll=.01).run() == "completed"
    used = [r for r in remote[1] if r.task_id == task]
    for site in ("p-a", "p-b"):
        assert len([r for r in used if r.site_id == site and r.step == "learn" and r.unit_key == "learn-private"]) == 1
        assert len([r for r in used if r.site_id == site and r.step == "compile"]) == 1
    view = client.get('/v1/tasks/'+task).json()
    assert view['status'] == 'completed' and len(view['rounds']) == 3


@pytest.mark.parametrize("preserve", [True, False])
@pytest.mark.parametrize("key", ["case", "long-case-" * 30])
def test_only_bad_output_discards_its_own_call_tree(platform, client, preserve, key):
    chosen = [{"participantId": "p-a", "datasetId": "ds-aime24"}, {"participantId": "p-b", "datasetId": "ds-aime25"}]
    task = client.post('/v1/tasks', json=math_config(chosen)).json()['id']
    with platform.db.session() as db:
        unit = m.WorkUnit(task_id=task, site_id="p-a", unit_key=key, round=1, step="solve", executor="platform", status="running", attempts=1)
        db.add(unit)
        db.flush()
        unit_id, site, key = unit.id, unit.site_id, unit.unit_key
    model = platform.gateway.model("fake:fake", ledger=LedgerKey(task, site, 1, "solve", key))
    model.chat("successful parent")
    model.fork("expert").chat("successful expert")
    other = platform.gateway.model("fake:fake", ledger=LedgerKey(task, site, 1, "solve", key + "other"))
    other.chat("unrelated case")
    fail_unit(platform.db, unit_id, 1, platform.registry.algorithm("fot").manifest.step("solve"),
              Outcome(False, "pause", pause=True, preserve_calls=preserve))
    with platform.db.session() as db:
        records = list(db.scalars(select(m.CallRecord).where(m.CallRecord.task_id == task).order_by(m.CallRecord.id)))
    assert [r.status for r in records] == (["ok"] * 3 if preserve else ["discarded", "discarded", "ok"])


def test_provider_restart_preserves_calls_instead_of_reporting_bad_output(platform, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from fedagent.agents.service import _connect, create_agent_app
    root = tmp_path / "provider"
    create_agent_app(platform, root, "fake:fake")
    with _connect(root / "runs.sqlite") as db:
        db.execute("INSERT INTO runs VALUES(?,?,?)", ('r', 'digest', '{"run_id":"r","status":"running"}'))
    with TestClient(create_agent_app(platform, root, "fake:fake")) as agent:
        status = agent.get('/runs/r').json()
    assert status['status'] == 'failed' and status['error_code'] == 'interrupted' and status['retryable']
    def request(self, aid, method, path, body=None):
        return {**status, 'run_id': body['run_id']}
    monkeypatch.setattr(AgentGateway, 'request', request)
    body = AgentRequest(run_id="r", algorithm="fot", version="1", task_type="math-reasoning", task_id="check-restart",
                        site_id="s", role="participant", round=1, rounds=2, step="solve", unit_key="case")
    with pytest.raises(AgentPending):
        AgentGateway(platform).execute('local', body)


def test_batch_with_real_activity_can_exceed_one_case_budget_but_checks_cannot(platform, client, monkeypatch):
    from fedagent.agents import gateway as module
    from fedagent.agents.progress_collector import ProgressCollector
    from fedagent.data import to_item
    clock = [0.0]
    polls = [0]
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(module.time, "sleep", lambda n: clock.__setitem__(0, clock[0]+6))
    monkeypatch.setattr(ProgressCollector, "pull", lambda self, enabled: setattr(self, "after", self.after + 1) or False)

    def request(self, agent, method, path, body=None):
        if method == "POST":
            rid[0] = body['run_id']
        polls[0] += 1
        return {'run_id': rid[0], 'status': 'succeeded' if polls[0] >= 5 else 'running', 'events_available': True,
                'result': {} if polls[0] >= 5 else None}
    monkeypatch.setattr(AgentGateway, "request", request)
    items = [to_item(platform.registry.task_type("math-reasoning"), {"id": str(i), "question": "x"}, labels=False) for i in range(3)]
    chosen = [{"participantId": "p-a", "datasetId": "ds-aime24"}, {"participantId": "p-b", "datasetId": "ds-aime25"}]
    task = client.post('/v1/tasks', json=math_config(chosen)).json()['id']
    with platform.db.session() as db:
        unit = m.WorkUnit(task_id=task, site_id="p-a", unit_key="_", round=1, step="extract", executor="agent", status="running")
        db.add(unit)
        db.flush()
        unit_id = unit.id
    body = AgentRequest(run_id="pending", algorithm="fot", version="1", task_type="math-reasoning", task_id=task,
                        site_id="s", role="participant", round=1, rounds=2, step="extract", unit_key="_", items=items)
    rid = [""]
    status = AgentGateway(platform).execute("local", body, unit_id=unit_id, timeout=10)
    assert status.status == "succeeded" and clock[0] > 10
    clock[0], polls[0] = 0, 0
    with pytest.raises(AgentPending):
        AgentGateway(platform).execute("local", body, timeout=10)
    clock[0], polls[0] = 0, 0
    monkeypatch.setattr(ProgressCollector, "pull", lambda self, enabled: False)
    with pytest.raises(AgentPending):
        AgentGateway(platform).execute("local", body, unit_id=unit_id, timeout=10)


def test_case_parallelism_is_bounded_and_compiles_identically_to_serial(platform, client, remote, monkeypatch):
    from fedagent_evomed.site import diagnose as original
    from test_api import run

    task = make_medical(client, remote)
    barrier = threading.Barrier(4, timeout=5)
    lock = threading.Lock()
    active, peak = 0, 0
    parallel = True

    def observe(case, *args, **kw):
        nonlocal active, peak
        if case['id'] == 'eval-private' or not parallel:
            return original(case, *args, **kw)
        with lock:
            active += 1
            peak = max(peak, active)
        barrier.wait()
        try:
            return original(case, *args, **kw)
        finally:
            with lock:
                active -= 1
    monkeypatch.setattr('fedagent_evomed.site.diagnose', observe)
    assert run(platform, task) == 'completed'
    assert peak == 4
    parallel = False
    config = client.get('/v1/tasks/'+task).json()['config']
    config.update(workers=1, checkId=None)
    config['checkId'] = client.post('/v1/task-checks', json=config).json()['id']
    second = client.post('/v1/tasks', json=config).json()['id']
    assert run(platform, second) == 'completed'
    with platform.db.session() as db:
        a = db.scalar(select(m.Artifact).where(m.Artifact.task_id == task))
        b = db.scalar(select(m.Artifact).where(m.Artifact.task_id == second))
        assert a.content == b.content
