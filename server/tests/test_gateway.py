import json

import httpx
import pytest
from fedagent_sdk import ModelError

from fedagent import models as m
from fedagent.gateway import LedgerKey
from fedagent.platform import Platform
from fedagent.seed import seed
from fedagent.settings import Settings


def make(tmp_path, handler):
    platform = Platform.create(Settings(data_dir=tmp_path), transport=httpx.MockTransport(handler))
    seed(platform)
    with platform.db.session() as session:
        session.add(
            m.Endpoint(
                id="ep-test",
                name="测试接口",
                base_url="https://llm.example/v1",
                models=["m1"],
                price=2.0,
                max_retries=3,
                api_key_enc=platform.secrets.encrypt("sk-test"),
            )
        )
    return platform


def test_retries_then_succeeds_and_records_cost(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("time.sleep", lambda _: None)
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) < 3:
            return httpx.Response(429, json={"error": "slow down"})
        body = json.loads(request.content)
        assert body["model"] == "m1" and body["temperature"] == 0.7
        assert request.headers["authorization"] == "Bearer sk-test"
        assert str(request.url) == "https://llm.example/v1/chat/completions"
        usage = {"prompt_tokens": 100, "completion_tokens": 900}
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}], "usage": usage})

    platform = make(tmp_path, handler)
    model = platform.gateway.model("ep-test:m1")
    result = model.chat("hi", temperature=0.7)
    assert result.text == "ok" and len(calls) == 3
    with platform.db.session() as session:
        row = session.query(m.CallRecord).one()
        assert row.cost == pytest.approx(1000 * 2.0 / 1_000_000)


def test_ledger_replays_completed_calls_without_billing_again(tmp_path) -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(200, json={"choices": [{"message": {"content": f"answer {len(calls)}"}}], "usage": {}})

    platform = make(tmp_path, handler)
    key = LedgerKey("task-x", "p-a", 1, "solve", "AIME24-000")
    first = platform.gateway.model("ep-test:m1", ledger=key).chat("same prompt")
    again = platform.gateway.model("ep-test:m1", ledger=key).chat("same prompt")
    assert first.text == again.text == "answer 1" and again.cached and len(calls) == 1


def test_client_errors_are_not_retried(tmp_path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "bad key"})

    platform = make(tmp_path, handler)
    with pytest.raises(ModelError, match="401"):
        platform.gateway.model("ep-test:m1").chat("hi")


def test_unconfigured_default_endpoint(tmp_path) -> None:
    platform = make(tmp_path, lambda request: httpx.Response(500))
    with pytest.raises(ModelError, match="还没有配置"):
        platform.gateway.model("default")
