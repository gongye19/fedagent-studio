import ast
import json
import subprocess
from types import SimpleNamespace

import pytest
from fedagent_sdk import ModelError
from fedagent_sdk.openai_compat import read_stream

from tools.lifestyle.diet_transport import REMOTE, CompletedUpstreamError, DietLink


def test_remote_hook_preserves_stream_and_redacts_credentials():
    tree = ast.parse(REMOTE)
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in {"clean", "inspect_stream"}]
    import re

    namespace = {"re": re, "json": json, "endpoint": SimpleNamespace(api_key="private-key-123"), "original": read_stream, "observed": []}
    exec(compile(ast.Module(body=functions, type_ignores=[]), "diagnostic-hook", "exec"), namespace)  # noqa: S102 - 本仓库固定观察钩子
    lines = ['data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}', "data: [DONE]"]
    assert namespace["inspect_stream"](lines) == read_stream(lines)
    result = namespace["inspect_stream"](
        ['data: {"error":{"message":"private-key-123 Bearer abc sk-secret https://example.test/key", "code":"overloaded"}}']
    )
    assert result.error  # 原解析结果不改变。
    captured = json.dumps(namespace["observed"])
    assert "private-key-123" not in captured and "sk-secret" not in captured and "example.test" not in captured and "abc" not in captured
    assert namespace["observed"][0]["code"] == "overloaded"


@pytest.mark.parametrize("completed", [True, False])
def test_error_details_saved_once_without_transport_retry(tmp_path, monkeypatch, completed):
    link = DietLink(tmp_path)
    link.base = ["ssh", "test"]
    monkeypatch.setattr(link, "check", lambda: None)
    requests = []

    def invoke(*args, **kwargs):
        requests.append(args)
        return SimpleNamespace(
            stdout=json.dumps(
                {"bridgeError": {"message": "generic", "upstream": [{"code": "overloaded"}], "completedUpstreamError": completed}}
            )
        )

    monkeypatch.setattr(subprocess, "run", invoke)
    with pytest.raises(CompletedUpstreamError if completed else ModelError):
        link.request({"messages": []})
    assert len(requests) == len(list(tmp_path.glob("upstream-*.json"))) == 1


def test_timeout_is_not_mistaken_for_completed_upstream_error(tmp_path, monkeypatch):
    link = DietLink(tmp_path)
    link.base = ["ssh", "test"]
    monkeypatch.setattr(link, "check", lambda: None)

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("ssh", 660)

    monkeypatch.setattr(subprocess, "run", timeout)
    with pytest.raises(ModelError) as error:
        link.request({"messages": []})
    assert not getattr(error.value, "completed_upstream_error", False)
    assert not list(tmp_path.iterdir())


def test_only_confirmed_overload_cools_down_next_dispatch(tmp_path, monkeypatch):
    from tools.lifestyle import diet_transport

    link = DietLink(tmp_path)
    link.base = ["ssh", "test"]
    monkeypatch.setattr(link, "check", lambda: None)
    now, sleeps = [100.0], []
    monkeypatch.setattr(diet_transport.time, "monotonic", lambda: now[0])

    def sleep(seconds):
        sleeps.append(seconds)
        now[0] += seconds

    monkeypatch.setattr(diet_transport.time, "sleep", sleep)
    replies = [
        {
            "bridgeError": {
                "completedUpstreamError": True,
                "upstream": [{"type": "upstream_error", "message": "Our servers are currently overloaded. Please try again later."}],
            }
        },
        {"text": "reply", "finish_reason": "stop"},
    ]
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: SimpleNamespace(stdout=json.dumps(replies.pop(0))))
    with pytest.raises(CompletedUpstreamError) as caught:
        link.request({"messages": []})
    assert caught.value.overloaded
    assert link.request({"messages": []})["text"] == "reply"
    assert sleeps == [45]
