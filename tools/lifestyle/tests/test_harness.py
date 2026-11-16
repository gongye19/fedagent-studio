import pytest
from fedagent_sdk import ModelError

from tools.lifestyle.evaluate import summarize
from tools.lifestyle.model import CachedModel
from tools.lifestyle.sources import assert_separated


def test_failed_arm_is_not_an_incorrect_case():
    arm = {"status": "complete", "assessment": {"score": 1, "unsafe": 0, "passed": True}}
    report = summarize([{"arms": {"without": arm, "local": arm, "shared": {"status": "failed"}}}])
    assert report["completePairedCases"] == 0 and report["incompleteCases"] == 1
    assert report["arms"]["without"]["score"] is None and report["arms"]["without"]["denominator"] == 0


def test_split_rejects_person_document_focus_or_input_reuse():
    train = {"person": "one", "document": "doc1", "focus": "topic1", "input": {"profile": "p", "question": "q"}}
    held = {"person": "two", "document": "doc2", "focus": "topic2", "input": {"profile": "other", "question": "q"}}
    assert_separated([train], [held])
    for key in ("person", "document", "focus", "input"):
        with pytest.raises(ValueError):
            assert_separated([train], [{**held, key: train[key]}])


def test_real_bridge_cache_and_budget_do_not_fall_back_to_fake(tmp_path, monkeypatch):
    from tools.lifestyle import model

    calls = []

    def remote(body):
        if body.get("inspect"):
            return {"model": "real", "endpoint": "remote", "kind": "openai", "baseUrl": "https://example.org"}
        calls.append(body)
        return {"text": "real bridge reply", "model": "real", "usage": {}, "finish_reason": "stop"}

    monkeypatch.setattr(model, "remote", remote)
    subject = CachedModel(tmp_path, "remote:real", 1)
    assert subject.chat("one", temperature=0.7, top_p=0.9).text
    assert subject.chat("one", temperature=0.7, top_p=0.9).cached
    with pytest.raises(ModelError):
        subject.chat("two")
    assert len(calls) == 1 and calls[0]["settings"] == {"temperature": 0.7, "top_p": 0.9}


def test_invalid_reply_can_be_replaced_and_provider_alias_is_recorded(tmp_path, monkeypatch):
    from tools.lifestyle import model

    calls = []

    def remote(body):
        if body.get("inspect"):
            return {"model": "configured", "endpoint": "remote", "kind": "openai", "baseUrl": "https://example.org"}
        calls.append(body)
        return {"text": "bad" if len(calls) == 1 else "good", "model": "configured-2026-11-01", "usage": {}, "finish_reason": "stop"}

    monkeypatch.setattr(model, "remote", remote)
    subject = CachedModel(tmp_path, "remote:configured", 2)
    assert subject.chat("question").text == "bad"
    subject.reject_last()
    assert subject.chat("question").text == "good"
    assert subject.chat("question").cached
    assert len(calls) == 2


def test_parallel_requests_share_budget_and_deduplicate(tmp_path, monkeypatch):
    import json
    import threading
    import time
    from concurrent.futures import ThreadPoolExecutor

    from tools.lifestyle import model

    active = 0
    peak = 0
    lock = threading.Lock()

    def remote(body):
        nonlocal active, peak
        if body.get("inspect"):
            return {"model": "real", "endpoint": "remote", "kind": "openai", "baseUrl": "https://example.org"}
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.04)
        with lock:
            active -= 1
        return {"text": "ok", "model": "real", "usage": {"prompt_tokens": 1}, "finish_reason": "stop"}

    monkeypatch.setattr(model, "remote", remote)
    subject = CachedModel(tmp_path, "remote:real", 3)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(subject.chat, ["one", "one", "two", "three"]))
    ledger = json.loads((tmp_path / "attempts.json").read_text())
    assert peak == 2 and len(ledger) == 3 and all(c["status"] == "ok" for c in ledger)
    assert sum(result.cached for result in results) == 1
    with pytest.raises(ModelError):
        subject.chat("over budget")


def test_bad_judge_can_resume_without_regenerating_answers(tmp_path, monkeypatch):
    import json
    from types import SimpleNamespace

    from fedagent_records.fot import RecordFoT

    from tools.lifestyle import model
    from tools.lifestyle.evaluate import evaluate

    generated, judged = [], []

    def remote(body):
        if body.get("inspect"):
            return {"model": "real", "endpoint": "remote", "kind": "openai", "baseUrl": "https://example.org"}
        judging = "LIFESTYLE_RUBRIC_V1" in body["messages"][0]["content"]
        if judging:
            judged.append(body)
            text = "malformed" if len(judged) == 1 else json.dumps({"items": [{"id": "safe", "met": True, "reason": "符合规则"}]})
        else:
            generated.append(body)
            text = "先确认运动限制，再从低冲击活动开始。"
        return {"text": text, "model": "real", "usage": {}, "finish_reason": "stop"}

    monkeypatch.setattr(model, "remote", remote)
    subject = CachedModel(tmp_path, "remote:real", 8)
    manifest = {
        "heldout": [
            {
                "id": "case",
                "site": "A",
                "input": {"profile": "合成用户，膝关节痛。", "question": "适合什么运动？"},
                "criteria": [{"id": "safe", "criterion": "考虑关节限制", "safety": True, "source": "https://www.cdc.gov/"}],
            }
        ]
    }
    state = {"local": {"A": {"l": "local"}}}
    platform = SimpleNamespace(registry=SimpleNamespace(algorithm=lambda _: RecordFoT()))
    first = evaluate(tmp_path, manifest, state, {"s": "shared"}, platform, subject)
    assert summarize(first)["incompleteCases"] == 1
    second = evaluate(tmp_path, manifest, state, {"s": "shared"}, platform, subject)
    assert summarize(second)["completePairedCases"] == 1
    assert len(generated) == 3 and len(judged) == 2


def test_experiment_lock_survives_main_thread_exception(tmp_path):
    import fcntl
    import subprocess
    import sys
    import time
    from pathlib import Path

    script = """
import sys,threading,time
from pathlib import Path
from tools.lifestyle.common import hold_experiment_lock
root=Path(sys.argv[1])
hold_experiment_lock(root)
threading.Thread(target=lambda:time.sleep(1.5)).start()
(root/'ready').touch()
raise RuntimeError('intentional main-thread failure')
"""
    process = subprocess.Popen(
        [sys.executable, "-c", script, str(tmp_path)], cwd=Path(__file__).resolve().parents[3], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    try:
        deadline = time.monotonic() + 5
        while not (tmp_path / "ready").exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert (tmp_path / "ready").exists() and process.poll() is None
        with (tmp_path / ".lock").open("a") as handle, pytest.raises(BlockingIOError):
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert process.wait(timeout=5) != 0
        with (tmp_path / ".lock").open("a") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
