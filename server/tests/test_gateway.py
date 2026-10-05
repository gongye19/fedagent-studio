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
    platform = Platform.create(Settings(data_dir=tmp_path, fake_endpoint=True), transport=httpx.MockTransport(handler))
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


def test_endpoint_check_lists_models_and_uses_algorithm_settings(tmp_path) -> None:
    from fastapi.testclient import TestClient

    from fedagent.api import create_app

    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer sk-test"
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "m1"}, {"id": "m2"}]})
        body = json.loads(request.content)
        sent.append(body)
        if body["model"] == "m2" and "top_p" in body:
            return httpx.Response(400, json={"error": {"message": "temperature and top_p cannot both be specified for this model"}})
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "OK"}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 3, "completion_tokens": 1}}
        )

    platform = make(tmp_path, handler)
    with platform.db.session() as session:
        session.get(m.Endpoint, "ep-test").models = ["m1", "m2", "m3"]
    with TestClient(create_app(platform)) as client:
        assert client.get("/v1/endpoints/ep-test/models").json() == {"models": ["m1", "m2"]}
        result = client.post("/v1/endpoints/ep-test/test").json()
    assert result["available"] == ["m1", "m2"]
    assert [(check["model"], check["ok"]) for check in result["checks"]] == [("m1", True), ("m2", False), ("m3", True)]
    assert result["ok"] is False
    assert "top_p" in result["message"]
    # 错误原因取接口返回的 message，不是整段 JSON
    assert result["checks"][1]["message"] == "接口返回 400：temperature and top_p cannot both be specified for this model"
    assert "模型列表里没有：m3" in result["message"]
    # 按算法实际用的生成参数发：FoT 最长输出 32768，temperature 0.7，top_p 0.9
    assert sent[0]["max_tokens"] == 32768
    assert sent[0]["temperature"] == 0.7
    assert sent[0]["top_p"] == 0.9


def test_retry_exhaustion_keeps_provider_reason(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("time.sleep", lambda _: None)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": {"message": "No available accounts"}})

    platform = make(tmp_path, handler)
    with pytest.raises(ModelError, match="接口返回 503：No available accounts"):
        platform.gateway.model("ep-test:m1").chat("hi")


def test_preview_models_with_typed_or_stored_key(tmp_path) -> None:
    from fastapi.testclient import TestClient

    from fedagent.api import create_app

    keys = []

    def handler(request: httpx.Request) -> httpx.Response:
        keys.append(request.headers.get("authorization"))
        return httpx.Response(200, json={"data": [{"id": "b-model"}, {"id": "a-model"}]})

    platform = make(tmp_path, handler)
    with TestClient(create_app(platform)) as client:
        typed = client.post("/v1/endpoints/models", json={"baseUrl": "https://other.example/v1", "apiKey": "sk-typed"})
        stored = client.post("/v1/endpoints/models", json={"baseUrl": "https://llm.example/v1", "endpointId": "ep-test"})
    assert typed.json() == {"models": ["a-model", "b-model"]}
    assert stored.json() == {"models": ["a-model", "b-model"]}
    # 填了密钥用填的；没填用这个接口已经保存的
    assert keys == ["Bearer sk-typed", "Bearer sk-test"]
