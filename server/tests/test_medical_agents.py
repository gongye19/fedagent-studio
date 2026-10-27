"""医疗系统由接入方运行；检查完整契约和用户侧经验的实际回用。"""
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from fedagent_sdk import Artifact, ChatResult
from intake_helpers import verify_one
from test_agents import fot_config
from test_medical import cases, medical_agents, medical_config, medical_dataset

from fedagent.agents.gateway import AgentGateway
from fedagent.agents.medical import create_medical_app, provider_platform
from fedagent.agents.protocol import AgentRequest, AgentResult
from fedagent.agents.store import AgentStore
from fedagent.data import check_file
from fedagent.gateway import GatewayModel


@pytest.mark.parametrize("step", ["solve", "reflect", "extract", "diagnose", "learn"])
def test_configuration_checks_business_output_of_every_step(platform, client, remote, monkeypatch, step):
    medical = step in ("diagnose", "learn")
    config = (medical_config([{"participantId": p, "datasetId": medical_dataset(client, p)} for p in ("p-a", "p-b")])
              if medical else fot_config(client))
    config.update(execution="agent", agentId=remote[0])
    if config["algorithm"] == "evomedclaw":
        medical_agents(client, config, remote[0])
    original = AgentGateway.execute

    def broken(self, agent_id, body, **kwargs):
        status = original(self, agent_id, body, **kwargs)
        if body.step == step:
            if step == "extract":
                status.result.sent[0].payload = {"name": ""}
            elif step == "learn":
                status.result.sent = []
            elif step == "diagnose":
                status.result.reports = {}
            else:
                status.result.kept = []
        return status

    monkeypatch.setattr(AgentGateway, "execute", broken)
    report = verify_one(client, config)
    result = client.get("/v1/task-checks/" + report["id"]).json()
    assert result["status"] == "failed", result
    assert any(row["status"] == "failed" and row["message"] for row in result["results"])
    config["checkId"] = report["id"]
    assert client.post("/v1/tasks", json=config).status_code == 422


def test_medical_requires_agent_and_publishes_downloadable_contract(client):
    config = medical_config([{"participantId": p, "datasetId": medical_dataset(client, p)} for p in ("p-a", "p-b")])
    result = client.post("/v1/tasks/validate", json=config).json()
    assert any("需要 Agent 系统" in row["message"] for row in result["issues"])
    registry = client.get("/v1/registry").json()
    assert next(a for a in registry["algorithms"] if a["id"] == "evomedclaw")["requirements"]["agentRequired"]
    assert next(a for a in registry["algorithms"] if a["id"] == "evomedclaw")["requirements"]["executionModes"] == ["agent"]
    contract = client.get("/v1/agent-protocol").json()
    assert "clinical-cards" in json.dumps(contract["outputContracts"]["evomedclaw"])
    assert "load_memory" in contract["outputContracts"]["evomedclaw"]
    assert contract["dataContracts"]["math-reasoning"]["template"][0]["question"] == ""


@pytest.mark.parametrize("code,retryable,hint", [
    ("diagnosis_incomplete", True, "调整问诊回合上限"),
    ("invalid_output", False, "算法输出规范"),
])
def test_agent_errors_are_actionable_and_stop_further_paid_checks(client, remote, monkeypatch, code, retryable, hint):
    config = medical_config([{"participantId": p, "datasetId": medical_dataset(client, p)} for p in ("p-a", "p-b")])
    config.update(execution="agent", agentId=remote[0])
    if config["algorithm"] == "evomedclaw":
        medical_agents(client, config, remote[0])
    original = AgentGateway.request
    submitted = []

    def failed(self, agent_id, method, path, body=None):
        if method == "POST" and path == "/runs":
            submitted.append(body)
            return {"run_id": body["run_id"], "status": "failed", "retryable": retryable,
                    "error_code": code, "error": "UNTRUSTED-REMOTE-ERROR"}
        return original(self, agent_id, method, path, body)

    monkeypatch.setattr(AgentGateway, "request", failed)
    checked = verify_one(client, config)
    report = client.get("/v1/task-checks/" + checked["id"]).json()
    assert report["status"] == "failed" and 1 <= len(submitted) <= 2
    assert all(request["step"] == "diagnose" for request in submitted)
    assert hint in json.dumps(report, ensure_ascii=False)
    assert "UNTRUSTED-REMOTE-ERROR" not in json.dumps(report)


def test_independent_agents_persist_and_use_scoped_experience(platform, tmp_path, monkeypatch):
    entry = {"entry_id": "experience-canary", "department": "general_internal_medicine", "owner_role": "local_doctor", "stage": "intake",
             "summary": "headache", "guidance": "EXPERIENCE-CANARY", "required_evidence": []}
    artifact = {"version": 2, "round": 2, "kind": "clinical-memory", "content": {"memory": {"entries": [entry]}, "cards": []}}
    prompts = []

    def chat(self, prompt, **kwargs):
        prompts.append(json.dumps(prompt))
        return ChatResult("DIAGNOSIS READY: migraine", "fake", {})

    monkeypatch.setattr(GatewayModel, "chat", chat)
    root_a, root_b = tmp_path / "a", tmp_path / "b"
    with TestClient(create_medical_app(platform, root_a, "fake:fake")) as a, TestClient(create_medical_app(platform, root_b, "fake:fake")) as b:
        assert set(a.get("/capabilities").json()["algorithms"]) == {"evomedclaw"}
        assert a.post("/experience", json={"task_id": "task", "site_id": "site", "artifact": artifact}).status_code == 200
        assert a.post("/experience", json={"task_id": "task", "site_id": "site", "artifact": {**artifact, "version": 1}}).status_code == 422
        body = {"task_id": "task", "site_id": "site", "case": cases()[0]}
        for agent, patch, version in [(a, {}, 2), (a, {"use_experience": False}, None), (b, {}, None), (a, {"site_id": "other"}, None)]:
            result = agent.post("/diagnose", json={**body, **patch})
            assert result.status_code == 200, result.text
            assert result.json()["experience_version"] == version
        assert "EXPERIENCE-CANARY" in prompts[0] and all("EXPERIENCE-CANARY" not in prompt for prompt in prompts[1:])
    with TestClient(create_medical_app(platform, root_a, "fake:fake")) as restarted:
        assert restarted.post("/diagnose", json=body).json()["experience_version"] == 2


def test_preflight_does_not_activate_or_store_patient_state(tmp_path):
    store = AgentStore(tmp_path)
    body = AgentRequest(run_id="r", algorithm="evomedclaw", version="1.0.0", task_type="medical-diagnosis",
                        task_id="check-one", site_id="site", role="participant", round=2, rounds=2, step="diagnose", unit_key="i",
                        artifact=Artifact(1, 1, "clinical-memory", {"memory": {"entries": []}}))
    store.record(body, AgentResult(kept=[("diagnostic_trajectory", "i", {"patient": "PRIVATE"})]))
    assert store.memory("check-one", "site") is None
    with store.connect() as db:
        assert db.execute("SELECT count(*) FROM private_state").fetchone()[0] == 0


def test_upload_cannot_silently_override_duplicate_fields(platform, client):
    raw = b'{"id":"one","question":"a","question":"b"}\n'
    assert not check_file(platform.registry.task_type("math-reasoning"), raw).ok
    before = client.get("/v1/datasets").json()
    response = client.post("/v1/resources/data", data={"taskType": "math-reasoning", "name": "rejected", "hosting": "platform"},
                           files={"file": ("bad.jsonl", raw)})
    assert response.status_code == 422
    assert client.get("/v1/datasets").json() == before


def test_independent_provider_uses_its_own_database_and_model(tmp_path, monkeypatch):
    monkeypatch.setenv("FEDAGENT_DATABASE_URL", "sqlite:////must-not-open/shared.db")
    monkeypatch.setenv("MEDICAL_LLM_BASE_URL", "https://llm.test/v1")
    monkeypatch.setenv("MEDICAL_LLM_MODEL", "user-model")
    monkeypatch.setenv("MEDICAL_LLM_API_KEY", "test-only-user-key")
    platform, ref = provider_platform(tmp_path, None)
    assert str(tmp_path) in platform.settings.db_url and "shared.db" not in platform.settings.db_url
    assert platform.gateway.resolve(ref)[1] == "user-model"
    requests = []

    def reply(request):
        requests.append(request)
        assert request.headers["Authorization"] == "Bearer test-only-user-key"
        return httpx.Response(200, json={"model": "user-model", "choices": [
            {"message": {"content": "DIAGNOSIS READY: migraine"}, "finish_reason": "stop"}], "usage": {}})

    platform.gateway._transport = httpx.MockTransport(reply)
    with TestClient(create_medical_app(platform, tmp_path, ref)) as agent:
        result = agent.post("/diagnose", json={"task_id": "own", "site_id": "own", "case": cases()[0]})
        assert result.status_code == 200 and result.json()["diagnosis"].endswith("migraine"), result.text
    assert len(requests) == 1 and requests[0].url.path == "/v1/chat/completions"
