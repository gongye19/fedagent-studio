from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fedagent.agents.gateway import AgentError, AgentGateway
from fedagent.agents.protocol import AgentRequest, AgentResult, AlgorithmCapability, Capabilities
from fedagent.agents.runtime import context_of
from fedagent.api import create_app
from fedagent.gateway import LedgerKey
from fedagent.platform import Platform
from fedagent.seed import seed
from fedagent.settings import Settings


@pytest.fixture
def platform(tmp_path: Path) -> Platform:
    created = Platform.create(Settings(data_dir=tmp_path, fake_endpoint=True))
    seed(created)
    return created


@pytest.fixture
def client(platform: Platform) -> Iterator[TestClient]:
    with TestClient(create_app(platform)) as test_client:
        yield test_client


@pytest.fixture
def remote(platform, client, monkeypatch):
    # 专门测试通用 Agent 适配器：在本测试实例开放 FoT，生产清单仍拒绝新建外部 FoT 任务。
    monkeypatch.setattr(platform.registry.algorithm("fot").manifest, "agent_supported", True)
    requests = []
    cache = {}
    caps = Capabilities(
        algorithms={
            a.id: AlgorithmCapability(version=a.version, steps=[s.id for s in a.manifest.steps if s.at != "server"])
            for a in platform.registry.algorithms.values()
        }
    )

    def request(self, agent_id, method, path, body=None):
        if path == "/capabilities":
            return caps.model_dump(mode="json")
        if method == "GET" or path.endswith("/cancel"):
            run_id = path.split("/")[2]
            if run_id not in cache:
                raise AgentError("Agent 服务尚未确认该运行")
            return cache[run_id]
        req = AgentRequest.model_validate(body)
        if req.run_id in cache:
            return cache[req.run_id]
        requests.append(req)
        algorithm = platform.registry.algorithm(req.algorithm)
        step = algorithm.manifest.step(req.step)
        model = (
            platform.gateway.model(
                "fake:fake", purpose="agent", ledger=LedgerKey(req.task_id, req.site_id, req.round, req.step, req.unit_key), plugin=algorithm, step_id=req.step
            )
            if step.model
            else None
        )
        ctx = context_of(req, algorithm, model)
        algorithm.run_step(ctx)
        result = AgentResult(kept=ctx.result.kept, sent=ctx.result.sent, reports=ctx.result.reports, predictions=ctx.result.predictions)
        cache[req.run_id] = {"run_id": req.run_id, "status": "succeeded", "result": result.model_dump(mode="json")}
        return cache[req.run_id]

    monkeypatch.setattr(AgentGateway, "request", request)
    response = client.post("/v1/agents", json={"name": "仅测试的独立 Agent", "baseUrl": "https://agent.test"})
    assert response.status_code == 201, response.text
    return response.json()["id"], requests
