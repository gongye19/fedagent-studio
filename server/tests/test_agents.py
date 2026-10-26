"""Agent 接口与 LLM 分离、真实 SDK 工作单元适配和配置测试的信任边界。"""

from __future__ import annotations

from datetime import timedelta

import httpx
import pytest
from fedagent_sdk import Manifest, OutgoingMessage
from sqlalchemy import select
from test_medical import medical_agents, medical_config, medical_dataset

from fedagent import models as m
from fedagent.agents.adapter import validate_result
from fedagent.agents.gateway import AgentError, AgentGateway
from fedagent.agents.protocol import AgentRequest, AgentResult
from fedagent.agents.runtime import context_of
from fedagent.data import to_item
from fedagent.engine import TaskEngine


def fot_config(client):
    datasets = client.get("/v1/datasets").json()[:2]
    return {
        "scenario": "horizontal",
        "taskType": "math-reasoning",
        "algorithm": "fot",
        "participants": [{"participantId": d["participantId"], "datasetId": d["id"]} for d in datasets],
        "rounds": 2,
        "trialCap": 1,
        "clientModel": "fake:fake",
        "serverModel": "fake:fake",
        "params": {},
    }



def test_agent_credentials_are_write_only_and_address_change_clears_key(client):
    response = client.post("/v1/agents", json={"name": "Agent", "baseUrl": "https://a.test/api", "apiKey": "test-only-secret"})
    assert response.status_code == 201
    agent_id = response.json()["id"]
    assert response.json()["hasKey"] and "test-only-secret" not in response.text
    assert "test-only-secret" not in client.get("/v1/agents").text
    changed = client.put(f"/v1/agents/{agent_id}", json={"name": "Agent", "baseUrl": "https://b.test/api"}).json()
    assert not changed["hasKey"] and changed["revision"] == 2
    assert client.post("/v1/agents", json={"name": "bad", "baseUrl": "https://user:password@a.test"}).status_code == 422
    assert client.post("/v1/agents", json={"name": "bad", "baseUrl": "https://a.test?token=bad"}).status_code == 422


@pytest.mark.parametrize("medical", [False, True])
def test_remote_steps_two_rounds_share_artifact_and_grade_locally(platform, client, remote, medical):
    agent_id, requests = remote
    if medical:
        participants = client.get("/v1/participants").json()[:2]
        chosen = [{"participantId": p["id"], "datasetId": medical_dataset(client, p["id"])} for p in participants]
        config = medical_config(chosen)
    else:
        config = fot_config(client)
    config.update(execution="agent", agentId=agent_id, clientModel="absent:deliberately-unused")
    if medical:
        medical_agents(client, config, agent_id)
    assert client.post("/v1/tasks", json=config).status_code == 422
    report = client.post("/v1/task-checks", json=config)
    assert report.status_code == 202, report.text
    report = client.get("/v1/task-checks/" + report.json()["id"]).json()
    assert report["status"] == "passed", report
    config["checkId"] = report["id"]
    made = client.post("/v1/tasks", json=config)
    assert made.status_code == 201, made.text
    task_id = made.json()["id"]
    assert client.delete("/v1/agents/" + agent_id).status_code == 409
    with platform.db.session() as session:
        session.get(m.Task, task_id).status = "running"
    assert TaskEngine(platform, task_id, poll=0.01).run() == "completed"
    view = client.get("/v1/tasks/" + task_id).json()
    assert len([r for r in view["rounds"] if r.get("output")]) == 2
    assert all(r.get("correct") is not None for r in view["rounds"])
    assert any(req.round == 2 and req.artifact for req in requests)
    assert all(
        "answer" not in item.fields for req in requests if not platform.registry.algorithm(req.algorithm).manifest.step(req.step).labels for item in req.items
    )
    if medical:
        learning = [req for req in requests if req.step == "learn"]
        assert learning and all("answer" not in item.fields for req in learning for item in req.items if item.get("split") == "eval")
    published = client.post("/v1/apps", json={"taskId": task_id, "builtAfterRound": 2, "name": "仅测试发布"})
    assert published.status_code == 201, published.text
    config["rounds"] = 3
    assert client.post("/v1/tasks", json=config).status_code == 422


def test_check_expiry_and_resource_change_are_enforced(platform, client):
    config = fot_config(client)
    report = client.post("/v1/task-checks", json=config).json()
    check_id = report["id"]
    assert client.get("/v1/task-checks/" + check_id).json()["status"] == "passed"
    config["checkId"] = check_id
    config["name"] = "改名称不要求重测"
    assert client.post("/v1/tasks", json=config).status_code == 201
    with platform.db.session() as session:
        endpoint = session.get(m.Endpoint, "fake")
        endpoint.timeout += 1
    assert client.post("/v1/tasks", json=config).status_code == 422
    with platform.db.session() as session:
        session.get(m.Endpoint, "fake").timeout -= 1
        session.get(m.TaskCheck, check_id).created_at = m.now() - timedelta(minutes=16)
    assert client.post("/v1/tasks", json=config).status_code == 422


def test_agent_result_cannot_forge_scores_channels_or_item_ids(platform):
    algorithm = platform.registry.algorithm("fot")
    item = to_item(platform.registry.task_type("math-reasoning"), {"id": "one", "question": "2+2?", "answer": "4"}, labels=False)
    body = AgentRequest(
        run_id="test",
        algorithm="fot",
        version=algorithm.version,
        task_type="math-reasoning",
        task_id="test",
        site_id="A",
        role="participant",
        round=1,
        rounds=2,
        step="solve",
        unit_key="one",
        items=[item],
    )
    ctx = context_of(body, algorithm)
    for result in [
        AgentResult(reports={"correct": 99}),
        AgentResult(predictions=[("other", "4")]),
        AgentResult(predictions=[("one", "4"), ("one", "4")]),
        AgentResult(sent=[OutgoingMessage("trace", "bad", "one")]),
        AgentResult(kept=[("solution", "other", "bad")]),
    ]:
        with pytest.raises(AgentError):
            validate_result(result, ctx, {})


def test_agent_http_does_not_follow_redirect_or_expose_response_secret(platform, client):
    agent_id = client.post("/v1/agents", json={"name": "A", "baseUrl": "https://a.test", "apiKey": "test-secret"}).json()["id"]
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(302, headers={"location": "https://other.test"}, text="test-secret")

    gateway = AgentGateway(platform, transport=httpx.MockTransport(handler))
    with pytest.raises(AgentError, match="HTTP 302") as error:
        gateway.capabilities(agent_id)
    assert "test-secret" not in str(error.value) and calls == ["https://a.test/capabilities"]


def test_check_data_integrity_failure_does_not_call_agent(platform, client, remote):
    agent_id, requests = remote
    config = fot_config(client)
    config.update(execution="agent", agentId=agent_id)
    with platform.db.session() as session:
        dataset = session.get(m.Dataset, config["participants"][0]["datasetId"])
        path = platform.settings.datasets_dir / dataset.content_path
    path.write_text("broken\n")
    response = client.post("/v1/task-checks", json=config)
    assert response.status_code == 422
    assert not requests


def test_gateway_replays_same_unknown_run_after_lost_response(platform, client, remote, monkeypatch):
    agent_id, requests = remote
    config = fot_config(client)
    config.update(execution="agent", agentId=agent_id)
    made = client.post("/v1/task-checks", json=config).json()
    assert client.get("/v1/task-checks/" + made["id"]).json()["status"] == "passed"
    config["checkId"] = made["id"]
    task_id = client.post("/v1/tasks", json=config).json()["id"]
    with platform.db.session() as session:
        session.get(m.Task, task_id).status = "running"
    original = AgentGateway.request
    lost = []

    def lossy(self, *args, **kwargs):
        response = original(self, *args, **kwargs)
        if args[1:3] == ("POST", "/runs") and not lost:
            lost.append(response["run_id"])
            raise AgentError("test lost response")
        return response

    monkeypatch.setattr(AgentGateway, "request", lossy)
    assert TaskEngine(platform, task_id, poll=0.01).run() == "paused"
    with platform.db.session() as session:
        session.get(m.Task, task_id).status = "running"
    assert TaskEngine(platform, task_id, poll=0.01).run() == "completed"
    assert len([req for req in requests if req.run_id == lost[0]]) == 1
    with platform.db.session() as session:
        assert all(row.status == "succeeded" for row in session.scalars(select(m.AgentRun).where(m.AgentRun.task_id == task_id)))


def test_reference_service_persists_idempotency_and_late_cancel(platform, tmp_path):
    import time

    from fastapi.testclient import TestClient
    from sqlalchemy import func

    from fedagent.agents.reference import create_reference_app

    root = tmp_path / "independent-agent"
    algorithm = platform.registry.algorithm("fot")
    item = to_item(platform.registry.task_type("math-reasoning"), {"id": "one", "question": "2+2?", "answer": "4"}, labels=False)
    body = AgentRequest(
        run_id="persistent-run",
        algorithm="fot",
        version=algorithm.version,
        task_type="math-reasoning",
        task_id="check-reference",
        site_id="A",
        role="participant",
        round=1,
        rounds=2,
        step="solve",
        unit_key="one",
        items=[item],
    ).model_dump(mode="json")
    with TestClient(create_reference_app(platform, root, "fake:fake")) as agent:
        assert agent.post("/runs", json=body).status_code == 202
        status = None
        for _ in range(100):
            status = agent.get("/runs/persistent-run").json()
            if status["status"] in ("succeeded", "failed"):
                break
            time.sleep(0.1)
        assert status["status"] == "succeeded", status
        assert agent.post("/runs", json=body).json() == status
        assert agent.post("/runs", json={**body, "rounds": 3}).status_code == 409
        assert agent.post("/runs/late/cancel").json()["status"] == "canceled"
        assert agent.post("/runs", json={**body, "run_id": "late"}).json()["status"] == "canceled"
    with TestClient(create_reference_app(platform, root, "fake:fake")) as agent:
        assert agent.post("/runs", json=body).json() == status
    with platform.db.session() as session:
        assert session.scalar(select(func.count()).where(m.CallRecord.task_id == "check-reference")) == 1


def test_busy_agent_retries_same_run_number(platform, client, remote, monkeypatch):
    from threading import Lock

    from fedagent.agents.gateway import AgentBusy
    agent_id, requests = remote
    original = AgentGateway.request
    submitted = []
    submission_lock = Lock()
    def busy_once(self, aid, method, path, body=None):
        if method == 'POST' and path == '/runs':
            with submission_lock:
                first = not submitted
                submitted.append(body['run_id'])
            if first:
                raise AgentBusy('busy')
        return original(self, aid, method, path, body)
    monkeypatch.setattr(AgentGateway, 'request', busy_once)
    config = fot_config(client)
    config.update(execution='agent', agentId=agent_id)
    report = client.post('/v1/task-checks', json=config).json()
    assert client.get('/v1/task-checks/' + report['id']).json()['status'] == 'passed'
    # 另一参与方可同时提交；繁忙请求仍复用原编号。
    assert submitted.count(submitted[0]) == 2
    assert len([req for req in requests if req.run_id == submitted[0]]) == 1


def test_failed_check_stops_unknown_run_and_reconcile_allows_cleanup(platform, client, remote, monkeypatch):
    agent_id, _ = remote
    original = AgentGateway.request
    lost = []
    def unknown(self, aid, method, path, body=None):
        if method == 'POST' and path == '/runs' and not lost:
            lost.append(body['run_id'])
            raise AgentError('lost response')
        if path.endswith('/cancel') and lost and lost[0] in path:
            raise AgentError('temporarily unreachable')
        return original(self, aid, method, path, body)
    monkeypatch.setattr(AgentGateway, 'request', unknown)
    config = fot_config(client)
    config.update(execution='agent', agentId=agent_id)
    report = client.post('/v1/task-checks', json=config).json()
    result = client.get('/v1/task-checks/' + report['id']).json()
    assert result['status'] == 'failed' and any(r['resource'] == 'Agent 停止确认' for r in result['results'])
    assert client.delete('/v1/agents/' + agent_id).status_code == 409
    def stopped(self, aid, method, path, body=None):
        if path.endswith('/cancel') and lost[0] in path:
            return {'run_id': lost[0], 'status': 'canceled'}
        return original(self, aid, method, path, body)
    monkeypatch.setattr(AgentGateway, 'request', stopped)
    assert client.post('/v1/agents/' + agent_id + '/check').status_code == 200
    assert client.delete('/v1/agents/' + agent_id).status_code == 204
    assert client.delete('/v1/task-checks/' + report['id']).status_code == 204


def test_downloaded_protocol_matches_installed_algorithms_and_has_no_credentials(client, platform):
    response = client.get('/v1/agent-protocol')
    assert response.status_code == 200
    value = response.json()
    assert value['protocol'] == 'fedagent-agent/1' and value['requestSchema']['properties']['items']
    assert value['algorithms']['fot']['version'] == platform.registry.algorithm('fot').version
    assert 'apiKey' not in response.text and 'api_key_enc' not in response.text


def test_explicit_retryable_failure_uses_algorithm_retry_without_rerunning_completed_items(platform, client, remote, monkeypatch):
    agent_id, requests = remote
    config = fot_config(client)
    config.update(execution='agent', agentId=agent_id)
    report = client.post('/v1/task-checks', json=config).json()
    config['checkId'] = report['id']
    task_id = client.post('/v1/tasks', json=config).json()['id']
    original = AgentGateway.request
    failed = []
    def once(self, aid, method, path, body=None):
        response = original(self, aid, method, path, body)
        if method == 'POST' and path == '/runs' and body['task_id'] == task_id and not failed:
            failed.append((body['site_id'], body['step'], body['unit_key']))
            return {'run_id': body['run_id'], 'status': 'failed', 'retryable': True}
        return response
    monkeypatch.setattr(AgentGateway, 'request', once)
    with platform.db.session() as session:
        session.get(m.Task, task_id).status = 'running'
    assert TaskEngine(platform, task_id, poll=0.01).run() == 'completed'
    first = failed[0]
    executions = [req for req in requests if req.task_id == task_id and (req.site_id, req.step, req.unit_key) == first and req.round == 1]
    assert len(executions) == 2 and executions[0].run_id != executions[1].run_id
    with platform.db.session() as session:
        units = list(session.scalars(select(m.WorkUnit).where(m.WorkUnit.task_id == task_id)))
        assert sum(row.attempts > 1 for row in units) == 1
        assert any(row.status == 'discarded' for row in session.scalars(select(m.CallRecord).where(m.CallRecord.task_id == task_id)))


def test_fot_requires_llm_workflow_and_rejects_external_agent_before_calls(client, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("不支持的执行方式不应调用 Agent")

    monkeypatch.setattr(AgentGateway, "request", forbidden)
    config = {**fot_config(client), "execution": "agent", "agentId": "missing"}
    registry = client.get("/v1/registry").json()
    fot = next(a for a in registry["algorithms"] if a["id"] == "fot")
    assert fot["requirements"]["executionModes"] == ["platform", "local"]
    assert not fot["requirements"]["agentRequired"]
    from fedagent.registry import Registry

    manifest = Registry.discover().algorithm("fot").manifest
    with pytest.raises(ValueError, match="必须支持 Agent"):
        Manifest.model_validate({**manifest.model_dump(), "agent_required": True})
    result = client.post("/v1/tasks/validate", json=config).json()
    assert any("数据与 LLM" in row["message"] for row in result["issues"])
    assert client.post("/v1/task-checks", json=config).status_code == 422
    assert client.post("/v1/tasks", json=config).status_code == 422
    assert client.post("/v1/tasks/validate", json=fot_config(client)).json()["issues"] == []
