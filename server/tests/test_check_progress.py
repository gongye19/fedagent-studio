"""预检并发、进度持久化、等待上限与失败后停止调度。"""
from threading import Barrier

import httpx
from intake_helpers import verify_one, verify_resources
from test_agents import fot_config
from test_medical import medical_agents, medical_config, medical_dataset

from fedagent import models as m
from fedagent.agents.gateway import AgentGateway
from fedagent.checks.progress import parallel


def test_independent_agents_overlap_and_publish_real_step_progress(platform, client, remote, monkeypatch):
    config = medical_config([{"participantId": p, "datasetId": medical_dataset(client, p)} for p in ("p-a", "p-b")])
    config.update(execution="agent", agentId=remote[0])
    medical_agents(client, config, remote[0])
    verify_resources(client, config)
    config["grader"] = "diagnosis-exact"  # 单独验证两Agent并行，独立评测模型的第三个探测由其他测试覆盖。
    calls_before = len(remote[1])
    original = AgentGateway.request
    rendezvous = Barrier(2)
    first = set()

    def overlapping(self, agent_id, method, path, body=None):
        if path == "/capabilities" and agent_id not in first:
            first.add(agent_id)
            rendezvous.wait(timeout=5)
            with platform.db.session() as session:
                row = session.scalars(__import__("sqlalchemy").select(m.TaskCheck).where(m.TaskCheck.status == "running")).first()
                active = [r for r in row.results if r["status"] == "running"]
                assert len(active) == 2
                assert all("正在检查" in r["message"] for r in active)
            rendezvous.wait(timeout=5)
        return original(self, agent_id, method, path, body)

    monkeypatch.setattr(AgentGateway, "request", overlapping)
    report = client.post("/v1/task-checks", json=config).json()
    result = client.get("/v1/task-checks/" + report["id"]).json()
    assert result["status"] == "passed", result
    assert len(first) == 2
    assert len(remote[1]) == calls_before
    assert all(row["status"] != "running" for row in result["results"])


def test_failed_batch_does_not_start_more_paid_jobs():
    started = []
    def job(index):
        started.append(index)
        return index != 0
    assert not parallel([lambda i=i: job(i) for i in range(5)])
    assert set(started) == {0, 1}


def test_agent_check_has_one_shared_budget_for_all_steps(client, remote, monkeypatch):
    from fedagent.agents import contract_check as agent
    monkeypatch.setattr(agent, "AGENT_CHECK_SECONDS", 0)
    config = fot_config(client)
    config.update(execution="agent", agentId=remote[0])
    report = verify_one(client, config)
    result = client.get("/v1/task-checks/" + report["id"]).json()
    assert result["status"] == "failed"
    assert any("接入验证超过 10 分钟" in r["message"] for r in result["results"])
    assert not remote[1]


def test_same_model_default_and_explicit_alias_are_probed_once(platform, client, monkeypatch):
    config = fot_config(client)
    with platform.db.session() as session:
        endpoint = session.get(m.Endpoint, "default")
        endpoint.kind = "fake"
        endpoint.models = ["fake"]
    config.update(clientModel="default", serverModel="default:fake")
    probes = []
    def probe(endpoint_id, model, settings):
        probes.append((endpoint_id, model))
        return "连接正常"
    monkeypatch.setattr("fedagent.checks.service.model_connection", lambda platform, endpoint_id: probe(endpoint_id, "fake", {}))
    report = client.post("/v1/task-checks", json=config).json()
    assert client.get("/v1/task-checks/" + report["id"]).json()["status"] == "passed"
    assert probes == [("default", "fake")]


def test_model_probe_reports_failure_without_automatic_retries(platform, client):
    import pytest
    from fedagent_sdk import ModelError
    endpoint = client.post("/v1/endpoints", json={"name": "local-test", "baseUrl": "https://llm.test/v1", "models": ["m"]}).json()
    calls = []
    def unavailable(request):
        calls.append(request)
        assert request.extensions["timeout"]["read"] == 30
        return httpx.Response(503, json={"error": {"message": "temporarily unavailable"}})
    platform.gateway._transport = httpx.MockTransport(unavailable)
    with pytest.raises(ModelError):
        platform.gateway.probe(endpoint["id"], "m", {"max_tokens": 128})
    assert len(calls) == 1


def test_busy_model_slot_returns_instead_of_waiting_for_task(platform, client):
    import pytest
    from fedagent_sdk import ModelError
    with platform.db.session() as session:
        session.get(m.Endpoint, "fake").concurrency = 1
    endpoint = platform.gateway.endpoint("fake")
    with platform.gateway.slot(endpoint), pytest.raises(ModelError, match="繁忙"), platform.gateway.slot(endpoint, wait_timeout=0.01):
        pytest.fail("配置测试不应抢占已经占用的槽位")
