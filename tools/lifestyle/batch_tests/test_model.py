import pytest
from fedagent_sdk import ModelError

from tools.lifestyle.common import load, save
from tools.lifestyle.model import CachedModel


def remote(body):
    if body.get("inspect"):
        return {"endpoint": "test", "model": "test", "kind": "openai", "baseUrl": "https://test.invalid"}
    return {"text": "ok", "model": "test", "usage": {}, "finish_reason": "stop"}


def test_old_ceiling_stays_fifty_and_expansion_is_explicit(tmp_path, monkeypatch):
    monkeypatch.setattr("tools.lifestyle.model.remote", remote)
    with pytest.raises(ValueError):
        CachedModel(tmp_path, "test:test", 51)
    with pytest.raises(ValueError):
        CachedModel(tmp_path, "test:test", 851, ceiling=851)
    model = CachedModel(tmp_path, "test:test", 850, ceiling=850, reserved=730)
    for i in range(120):
        assert model.chat(str(i)).text == "ok"
    with pytest.raises(ModelError, match="120"):
        model.chat("reserved")
    assert model.budget_exhausted and len(load(tmp_path / "attempts.json")) == 120
    assert model.chat("0").cached
    model.reserved = 0
    assert model.chat("reserved").text
    assert len(load(tmp_path / "attempts.json")) == 121


def test_context_stop_precedes_any_paid_dispatch(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr("tools.lifestyle.model.remote", lambda b: calls.append(b) or remote(b))
    model = CachedModel(tmp_path, "test:test", context_cap=1100)
    with pytest.raises(ModelError, match="上下文"):
        model.chat("x" * 1000, max_tokens=100)
    assert model.context_failure and len(calls) == 1  # only read-only inspect
    assert not (tmp_path / "attempts.json").exists()


def test_reply_cache_corruption_does_not_trigger_new_dispatch(tmp_path, monkeypatch):
    monkeypatch.setattr("tools.lifestyle.model.remote", remote)
    model = CachedModel(tmp_path, "test:test", context_cap=131072)
    model.chat("one")
    path = next((tmp_path / "calls").glob("*.json"))
    value = load(path)
    value["result"]["text"] = "changed"
    save(path, value)
    with pytest.raises(ModelError, match="回复缓存摘要"):
        model.chat("one")
    assert len(load(tmp_path / "attempts.json")) == 1
