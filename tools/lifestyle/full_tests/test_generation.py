import json
import threading
import time
from collections import Counter

import pytest
from fedagent_sdk import ModelError

from tools.lifestyle import model as bridge
from tools.lifestyle.common import digest, load, save
from tools.lifestyle.full.generation import prepare as preparation
from tools.lifestyle.full.generation.progress import request_hash, usage
from tools.lifestyle.full.generation.runner import HaltOnFailure, run
from tools.lifestyle.full.generation.templates import (
    CONTEXT_CAP,
    SETTINGS,
    make_case,
    parse_reply,
)

IDENTITY = {
    "endpoint": "default",
    "model": "gpt-5.6-luna",
    "kind": "openai",
    "baseUrl": "https://example.test/v1",
}
CATALOG = {
    name: {
        "url": "https://example.test/source",
        "revision": "fixed",
        "license": "test-fixture",
        "dataset": name,
        "licenseSource": "https://example.test/license",
    }
    for name in ("medquad.zip", "medmcqa-train-00000-of-00001.parquet")
}


def source(index, publisher="NHS"):
    if publisher in ("MedQuAD", "MedMCQA"):
        raw = {
            "id": ("medquad:5_NIDDK_QA/" if publisher == "MedQuAD" else "medmcqa:train:") + str(index),
            "source": publisher,
            "document": "5_NIDDK_QA/test.xml",
            "question": "reference question",
            "reference": {"answer": "full original evidence"},
            "generationInput": {
                "profile": "公开参考，未提供个人病史",
                "question": "这份参考能支持哪些有条件的生活方式建议？",
            },
        }
        return {
            "id": raw["id"],
            "source": publisher,
            "layer": "evidence" if publisher == "MedQuAD" else "optional-support",
            "original": raw,
            "payloadDigest": preparation.sha(preparation.encoded(raw)),
        }
    raw = {
        "id": f"{publisher.lower()}-section{index}:1",
        "publisher": publisher,
        "population": "adults",
        "region": "England",
        "sourceTitle": f"公开文档{index}",
        "heading": "有条件的运动指导",
        "text": "public reference section",
        "fullArticleText": "complete source context",
        "finalUrl": f"https://example.test/{index}",
        "documentId": f"doc{index}",
        "sourceDates": ["2026"],
        "reuse": {"license": "test-fixture"},
    }
    return {
        "id": "guidance:" + raw["id"],
        "source": publisher,
        "layer": "guidance",
        "original": raw,
        "payloadDigest": preparation.sha(preparation.encoded(raw)),
    }


def cases_for(n, publisher="NHS"):
    return [make_case(source(i, publisher), "source-fingerprint", CATALOG, IDENTITY["model"]) for i in range(n)]


def plan_for(cases, **kw):
    return {
        "modelRef": "default:gpt-5.6-luna",
        "callLimit": 500,
        "contextCap": CONTEXT_CAP,
        "settings": SETTINGS,
        "failureCircuit": 10,
        "counts": dict(Counter(c["source"] for c in cases)),
        **kw,
    }


@pytest.fixture
def remote(monkeypatch):
    state = {"mode": "ok", "calls": 0, "inspections": 0, "active": 0, "maximum": 0}
    lock = threading.Lock()

    def fake(request):
        if request.get("inspect"):
            state["inspections"] += 1
            return IDENTITY
        with lock:
            state["calls"] += 1
            state["active"] += 1
            state["maximum"] = max(state["maximum"], state["active"])
        try:
            time.sleep(0.005)
            if state["mode"] == "transport":
                raise ModelError("simulated connection failure")
            text = (
                "invalid-json"
                if state["mode"] == "invalid"
                else json.dumps(
                    {
                        "events": [{"role": "advisor", "content": "公开参考的条件说明"}],
                        "output": "测试夹具，不是医疗建议",
                    }
                )
            )
            return {
                "text": text,
                "model": IDENTITY["model"],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
                "finish_reason": "stop",
            }
        finally:
            with lock:
                state["active"] -= 1

    monkeypatch.setattr(bridge, "remote", fake)
    return state


def test_generated_counts_and_resume_are_not_extraction(tmp_path, remote):
    cases = cases_for(5)
    plan = plan_for(cases)
    first = run(tmp_path, plan, cases, take=2)
    assert first["counts"]["generated"] == 2 and first["state"]["status"] == "paused-by-limit"
    final = run(tmp_path, plan, cases)
    assert final["counts"]["generated"] == remote["calls"] == 5
    assert final["uploaded"] == final["extracted"] == 0 and final["finalExperiences"] is None
    assert remote["maximum"] <= 2 and final["state"]["status"] == "complete"
    inspections = remote["inspections"]
    run(tmp_path, plan, cases)
    assert remote["inspections"] == inspections and remote["calls"] == 5


def test_two_bad_formats_are_terminal_per_unit_without_resubmission(tmp_path, remote):
    remote["mode"] = "invalid"
    cases = cases_for(3)
    result = run(tmp_path, plan_for(cases), cases)
    assert result["counts"]["terminalFailed"] == 3 and remote["calls"] == 6
    assert result["state"]["status"] == "complete-with-failures"
    run(tmp_path, plan_for(cases), cases)
    assert remote["calls"] == 6


def test_failure_circuit_stops_new_work_and_is_not_reset(tmp_path, remote):
    remote["mode"] = "invalid"
    cases = cases_for(12)
    result = run(tmp_path, plan_for(cases, failureCircuit=2), cases)
    assert result["state"]["terminal"]
    assert 2 <= result["counts"]["terminalFailed"] <= 3 and remote["calls"] <= 6
    before = remote["calls"]
    run(tmp_path, plan_for(cases, failureCircuit=2), cases)
    assert remote["calls"] == before


def test_transport_failure_stops_and_can_explicitly_resume_same_budget(tmp_path, remote):
    cases = cases_for(1)
    remote["mode"] = "transport"
    first = run(tmp_path, plan_for(cases), cases)
    assert first["state"]["status"] == "interrupted" and first["counts"]["pendingAfterDispatch"] == 1
    assert first["possiblyBilledFailedDispatches"] == 1
    remote["mode"] = "ok"
    final = run(tmp_path, plan_for(cases), cases)
    assert final["counts"]["generated"] == 1 and final["remoteAttempts"] == 2


def test_invalid_reply_then_transport_stops_new_units(tmp_path, monkeypatch):
    calls = []

    def fake(request):
        if request.get("inspect"):
            return IDENTITY
        calls.append(request)
        if len(calls) == 1:
            return {
                "text": "invalid-json",
                "model": IDENTITY["model"],
                "usage": {},
                "finish_reason": "stop",
            }
        raise ModelError("provider unavailable")

    monkeypatch.setattr(bridge, "remote", fake)
    cases = cases_for(8)
    result = run(tmp_path, plan_for(cases), cases)
    assert result["state"]["status"] == "interrupted"
    assert result["remoteAttempts"] <= 3
    assert result["counts"]["pendingNotDispatched"] >= 6


def test_second_explicit_transport_outage_does_not_advance(tmp_path, remote):
    remote["mode"] = "transport"
    cases = cases_for(8)
    first = run(tmp_path, plan_for(cases), cases)
    assert first["state"]["status"] == "interrupted"
    second = run(tmp_path, plan_for(cases), cases)
    assert second["state"]["status"] == "interrupted"
    assert second["remoteAttempts"] == 4 and second["possiblyBilledFailedDispatches"] == 4
    assert second["counts"]["pendingNotDispatched"] == 6


def test_shared_guard_blocks_retry_after_other_thread_transport_failure(tmp_path, monkeypatch):
    invalid_pending, failed = threading.Event(), threading.Event()
    calls = []

    def fake(request):
        if request.get("inspect"):
            return IDENTITY
        calls.append(request)
        content = request["messages"][0]["content"]
        if content == "invalid":
            invalid_pending.set()
            assert failed.wait(3)
            return {"text": "bad", "model": IDENTITY["model"], "usage": {}}
        assert invalid_pending.wait(3)
        raise ModelError("outage")

    monkeypatch.setattr(bridge, "remote", fake)
    guarded = HaltOnFailure(bridge.CachedModel(tmp_path, "default:gpt-5.6-luna", 10))
    from concurrent.futures import ThreadPoolExecutor

    def bad():
        guarded.chat([{"role": "user", "content": "invalid"}])
        with pytest.raises(ModelError, match="未发送"):
            guarded.chat([{"role": "user", "content": "retry"}])
        assert not guarded.was_dispatched()

    with ThreadPoolExecutor(max_workers=2) as pool:
        future = pool.submit(bad)
        with pytest.raises(ModelError):
            guarded.chat([{"role": "user", "content": "transport"}])
        failed.set()
        future.result()
    assert len(calls) == 2


def test_global_budget_does_not_start_an_extra_call(tmp_path, remote):
    cases = cases_for(5)
    result = run(tmp_path, plan_for(cases, callLimit=2), cases)
    assert result["state"]["terminal"] and result["remoteAttempts"] == remote["calls"] == 2
    run(tmp_path, plan_for(cases, callLimit=2), cases)
    assert remote["calls"] == 2


def test_unknown_dispatch_blocks_before_identity_inspection(tmp_path, remote):
    cases = cases_for(1)
    plan = plan_for(cases)
    save(tmp_path / "model.json", IDENTITY)
    save(
        tmp_path / "attempts.json",
        [
            {
                "ordinal": 1,
                "requestHash": request_hash(cases[0], plan, IDENTITY),
                "status": "started",
            }
        ],
    )
    result = run(tmp_path, plan, cases)
    assert result["state"]["terminal"] and result["counts"]["unresolvedDispatches"] == 1
    assert remote["calls"] == remote["inspections"] == 0


def test_runtime_checks_exact_escaped_message_size_before_model(tmp_path, remote):
    cases = cases_for(1)
    assert cases[0]["requestBytes"] == len(json.dumps(cases[0]["messages"], ensure_ascii=False).encode())
    cases[0]["requestBytes"] -= 1
    result = run(tmp_path, plan_for(cases), cases)
    assert result["state"]["terminal"] and remote["inspections"] == remote["calls"] == 0


def test_tampered_value_cannot_rebind_source_even_with_new_digest(tmp_path, remote):
    cases = cases_for(1)
    run(tmp_path, plan_for(cases), cases)
    path = tmp_path / "units" / (cases[0]["id"] + ".json")
    unit = load(path)
    unit["value"]["provenance"]["sourceDataset"] = "someone-else"
    unit["valueDigest"] = digest(unit["value"])
    save(path, unit)
    with pytest.raises(ValueError, match="binding"):
        usage(tmp_path, plan_for(cases), cases)
    assert remote["calls"] == 1


def test_three_layer_prompts_keep_full_evidence_and_no_patient_dialogue():
    cases = cases_for(1) + cases_for(1, "MedQuAD") + cases_for(1, "MedMCQA")
    assert len({c["messages"][0]["content"] for c in cases}) == 3
    assert cases[1]["collection"] == "5_NIDDK_QA" and cases[1]["source"] == "MedQuAD"
    assert all("个人" in c["input"]["profile"] or "公开参考" in c["input"]["profile"] for c in cases)
    assert all("/" not in c["id"] and len(c["provenance"]["sourceFingerprint"]) for c in cases)
    with pytest.raises(ValueError, match="contract"):
        parse_reply(
            json.dumps({"events": [{"role": "patient", "content": "invented"}], "output": "no"}),
            cases[0],
        )


def test_prepare_all_sources_offline_and_freezes_every_request(tmp_path, remote, monkeypatch):
    originals = [source(i, name) for name, n in preparation.COUNTS.items() for i in range(n)]
    fixture_source = tmp_path / "fixture-source"
    fixture_source.mkdir()
    (fixture_source / "records.jsonl").write_text("".join(json.dumps(r) + "\n" for r in originals))
    monkeypatch.setattr(preparation, "source_rows", lambda _: (originals, "frozen-source"))
    plan, cases = preparation.prepare(tmp_path, source=fixture_source)
    assert len(cases) == 444 and plan["counts"] == preparation.COUNTS
    assert len({c["source"] for c in cases[:8]}) == 6
    assert remote["inspections"] == remote["calls"] == 0
    assert all(c["requestBytes"] == len(json.dumps(c["messages"], ensure_ascii=False).encode()) for c in cases)
    assert preparation.prepare(tmp_path, source=fixture_source)[0] == plan
    changed = load(tmp_path / "inputs/plan.json")
    changed["callLimit"] = 999
    save(tmp_path / "inputs/plan.json", changed)
    with pytest.raises(ValueError, match="corrupted"):
        preparation.prepare(tmp_path, source=fixture_source)


def test_all_preflight_violations_are_listed_before_run(tmp_path, remote, monkeypatch):
    originals = [source(1), source(2)]
    for row in originals:
        row["original"]["fullArticleText"] = "x" * CONTEXT_CAP
    monkeypatch.setattr(preparation, "source_rows", lambda _: (originals, "fixed"))
    with pytest.raises(ValueError) as error:
        preparation.prepare(tmp_path)
    assert all(row["id"] in str(error.value) for row in originals)
    assert not (tmp_path / "inputs").exists() and remote["calls"] == remote["inspections"] == 0


def test_legacy_budget_profile_still_rejects_more_than_850(tmp_path, remote):
    with pytest.raises(ValueError):
        bridge.CachedModel(tmp_path, "default:gpt-5.6-luna", 851, ceiling=851)
    assert remote["inspections"] == 0


def pinned_source(tmp_path, monkeypatch, values):
    tmp_path.mkdir(exist_ok=True)
    raw = b"".join(preparation.encoded(r) + b"\n" for r in values)
    (tmp_path / "records.jsonl").write_bytes(raw)
    manifest = {
        "fingerprint": "test-source",
        "outputs": {"records.jsonl": preparation.sha(raw)},
    }
    manifest["manifestDigest"] = preparation.sha(preparation.encoded(manifest))
    content = preparation.encoded(manifest) + b"\n"
    (tmp_path / "manifest.json").write_bytes(content)
    monkeypatch.setattr(preparation, "SOURCE_MANIFEST_SHA", preparation.sha(content))
    return tmp_path


def test_source_counts_and_prefix_binding_reject_same_count_swap(tmp_path, remote, monkeypatch):
    values = [source(i, name) for name, n in preparation.COUNTS.items() for i in range(n)]
    original = pinned_source(tmp_path, monkeypatch, values)
    assert len(preparation.source_rows(original)[0]) == 444
    left = next(r for r in values if r["source"] == "MedQuAD")
    right = next(r for r in values if r["source"] == "NIDDK")
    left["source"], right["source"] = right["source"], left["source"]
    pinned_source(tmp_path, monkeypatch, values)
    with pytest.raises(ValueError, match="binding"):
        preparation.source_rows(original)
    assert remote["calls"] == remote["inspections"] == 0


def test_pinned_source_file_corruption_is_not_repaired(tmp_path, monkeypatch):
    values = [source(i, name) for name, n in preparation.COUNTS.items() for i in range(n)]
    original = pinned_source(tmp_path, monkeypatch, values)
    (original / "records.jsonl").write_text("changed")
    with pytest.raises(ValueError, match="corrupted"):
        preparation.source_rows(original)


def test_identity_change_is_fatal_before_new_paid_call(tmp_path, remote, monkeypatch):
    cases = cases_for(2)
    plan = plan_for(cases)
    run(tmp_path, plan, cases, take=1)
    before = remote["calls"]
    monkeypatch.setattr(bridge, "remote", lambda _: {**IDENTITY, "baseUrl": "https://changed.test/v1"})
    result = run(tmp_path, plan, cases)
    assert result["state"]["terminal"] and result["counts"]["generated"] == 1
    assert remote["calls"] == before


def test_status_of_unprepared_directory_is_read_only(tmp_path, monkeypatch, capsys):
    import sys

    from tools.lifestyle.full.generation import __main__ as cli

    monkeypatch.setattr(cli, "ROOT", tmp_path)
    target = tmp_path / "data/lifestyle-prep/full/run-20261119/generation"
    monkeypatch.setattr(sys, "argv", ["generation", "status", "--directory", str(target)])
    cli.main()
    assert json.loads(capsys.readouterr().out)["status"] == "not-prepared"
    assert not target.exists()


def test_cli_requires_prepare_and_first_sample_inspection(tmp_path, monkeypatch):
    import sys

    from tools.lifestyle.full.generation import __main__ as cli
    from tools.lifestyle.full.generation import runner

    monkeypatch.setattr(cli, "ROOT", tmp_path)
    target = tmp_path / "data/lifestyle-prep/full/run-20261119/generation"
    monkeypatch.setattr(sys, "argv", ["generation", "run", "--directory", str(target)])
    with pytest.raises(SystemExit):
        cli.main()
    assert not target.exists()
    (target / "inputs").mkdir(parents=True)
    cases = cases_for(8)
    plan = plan_for(cases, fingerprint="fixed")
    states = {c["id"]: "pendingNotDispatched" for c in cases}
    monkeypatch.setattr(cli, "hold_experiment_lock", lambda _: None)
    monkeypatch.setattr(cli, "prepare", lambda _: (plan, cases))
    monkeypatch.setattr(cli, "usage", lambda *_: ({}, states))
    executed = []
    monkeypatch.setattr(
        runner,
        "run",
        lambda *_, **kw: executed.append(kw) or {"state": {"status": "paused-by-limit"}},
    )
    with pytest.raises(SystemExit):
        cli.main()
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "generation",
            "run",
            "--directory",
            str(target),
            "--continue-after-inspection",
        ],
    )
    with pytest.raises(SystemExit):
        cli.main()
    assert not executed and not (target / "inspection.json").exists()
    monkeypatch.setattr(sys, "argv", ["generation", "run", "--directory", str(target), "--take", "8"])
    cli.main()
    assert executed == [{"take": 8}]
    for case in cases:
        save(target / "units" / (case["id"] + ".json"), {"valueDigest": "inspected"})
        states[case["id"]] = "generated"
    states[cases[0]["id"]] = "terminalFailed"
    save(target / "units" / (cases[0]["id"] + ".json"), {"failures": ["InvalidFormat", "InvalidFormat"]})
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "generation",
            "run",
            "--directory",
            str(target),
            "--continue-after-inspection",
        ],
    )
    cli.main()
    assert len(load(target / "inspection.json")["sampleValueDigests"]) == 7
    assert len(load(target / "inspection.json")["sampleTerminalFailures"]) == 1
    save(target / "units" / (cases[0]["id"] + ".json"), {"valueDigest": "changed"})
    with pytest.raises(SystemExit):
        cli.main()
    assert len(executed) == 2
