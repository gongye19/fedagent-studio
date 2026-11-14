"""独立评审中复现的边界问题，不调用真实模型。"""
import json
from types import SimpleNamespace
from unittest.mock import patch

import httpcore
import httpx
import pytest
from fedagent_evomed.grading import CLINICAL_RUBRIC, DiagnosisClinicalGrader
from fedagent_records.application import relevant_cards
from fedagent_sdk import ModelError
from test_medical_grading import Judge

from fedagent import models as m
from fedagent.experience import comparison_runtime, evaluation, frozen_cases
from fedagent.model_network import PublicModelBackend, allowed_address, model_client, validate_url
from fedagent.model_runtime import GatewayModel
from fedagent.runner import Child, Runner


@pytest.mark.parametrize("text,answer", [
    ("Not Bartter syndrome", "Bartter syndrome"),
    ("No evidence of Bartter syndrome", "Bartter syndrome"),
    ("Gitelman syndrome. Bartter syndrome was excluded", "Bartter syndrome"),
    ("A different diagnosis explains all findings", "Acute lymphoblastic leukemia (ALL)"),
    ("Mild dehydration", "Myocardial infarction (MI)"),
])
def test_no_substring_or_negated_diagnosis_shortcut(text, answer):
    judge = Judge("[0.0]")
    assert DiagnosisClinicalGrader().evaluate(text, {"answer": answer}, judge) is False
    assert len(judge.prompts) == 1
    assert "principal diagnosis" in judge.prompts[0][1]["content"]


def test_exact_diagnosis_and_original_clinical_rubric():
    import inspect

    from fedagent_evomed.vendor.runtime.department_first.standalone import compare_results
    assert CLINICAL_RUBRIC in "".join(value for value in compare_results.__code__.co_consts if isinstance(value, str))
    assert "_doctor_contains_correct_diagnosis" in inspect.getsource(compare_results)
    assert DiagnosisClinicalGrader().evaluate("  Pneumonia. ", {"answer": "pneumonia"})


def test_retrieval_ranks_across_all_buckets():
    entries = [dict(entry_id=f"{department}-{i}", department=department, owner_role="doctor", stage="synthesis",
                    summary="generic", guidance="general guidance")
               for department in ("cardiology", "dermatology", "endocrinology") for i in range(2)]
    entries.append(dict(entry_id="best", department="pediatrics", owner_role="doctor", stage="synthesis",
                        summary="specific", guidance="specific", required_evidence=["cough", "fever"]))
    result = relevant_cards({"memory": {"entries": entries}}, "cough fever")
    assert len(result) == 6 and result[0]["id"] == "best"
    assert not any(row["id"] == "best" for row in relevant_cards({"memory": {"entries": entries}}, "knee injury"))


@pytest.mark.parametrize("kind", ["empty", "invalid-score"])
@pytest.mark.parametrize("resolved", [False, True])
def test_retry_invalid_answer_or_grade_reuses_only_valid_work(platform, monkeypatch, kind, resolved):
    job = SimpleNamespace(id="retry", algorithm="fot-records", config={"model": "fake:fake"})
    case = {"site_id": "site", "input": {"patient": "Synthetic"}, "reference": "Reference"}
    calls = []
    def reply(model, prompt, digest):
        grading = "CLINICAL EQUIVALENCE" in prompt
        calls.append("grade" if grading else "answer")
        if grading:
            return "bad" if calls.count("grade") == 1 and kind == "invalid-score" else "[0.0]"
        if kind == "empty" and calls.count("answer") == 1:
            return ""
        return json.dumps({"diagnosis": "Other", "explanation": "Synthetic explanation"})
    monkeypatch.setattr(GatewayModel, "_fake", reply)
    endpoint = platform.gateway.resolve("fake:fake") if resolved else None
    with pytest.raises(ModelError):
        evaluation.evaluate_arm(platform, job, case, 0, "none", None, endpoint)
    assert evaluation.evaluate_arm(platform, job, case, 0, "none", None, endpoint).correct is False
    assert calls.count("answer") == (2 if kind == "empty" else 1)
    assert calls.count("grade") == (1 if kind == "empty" else 2)


def task(id_, **values):
    return m.Task(id=id_, name=id_, scenario="horizontal", task_type="math-reasoning", algorithm="fot",
                  plugin_version="review", plugin_hash="review", config={}, audit={}, **values)


def test_runner_commits_before_spawn_and_does_not_repeat_batch(platform, monkeypatch):
    platform.settings.max_running_tasks = 2
    with platform.db.session() as session:
        session.add_all([task("first", status="queued"), task("second", status="queued")])
    runner = Runner(platform)
    seen = []
    def spawn(task_id):
        with platform.db.session() as session:
            assert session.get(m.Task, task_id).status == "running"
        seen.append(task_id)
        if task_id == "second":
            raise OSError("synthetic failure")
        return SimpleNamespace(pid=123, poll=lambda: None)
    monkeypatch.setattr(runner, "_spawn", spawn)
    runner.tick()
    runner.tick()
    assert seen.count("first") == 1 and seen.count("second") == 2
    with platform.db.session() as session:
        assert session.get(m.Task, "first").status == "running"


@pytest.mark.parametrize("command,expected", [("cancel", "canceled"), ("pause", "paused")])
@pytest.mark.parametrize("managed", [True, False])
def test_runner_honors_commands_after_worker_death(platform, command, expected, managed):
    with platform.db.session() as session:
        session.add(task("stopped", status="running", command=command))
    runner = Runner(platform)
    if managed:
        runner.children["stopped"] = Child(SimpleNamespace(poll=lambda: -15), 0)
    runner.tick()
    with platform.db.session() as session:
        row = session.get(m.Task, "stopped")
        assert row.status == expected and row.command is None
    assert not runner.children


def test_live_orphan_uses_a_runner_slot(platform, monkeypatch):
    with platform.db.session() as session:
        session.add_all([task("orphan", status="running", pid=10), task("queued", status="queued")])
    runner = Runner(platform)
    monkeypatch.setattr("fedagent.runner.leftover_process", lambda pid, id_: True)
    monkeypatch.setattr(runner, "_stop_leftover", lambda *args: None)
    runner.tick()
    assert not runner.children


@pytest.mark.parametrize("url", ["http://127.0.0.1/v1", "http://169.254.169.254", "http://10.0.0.1",
                                  "http://[::ffff:127.0.0.1]", "http://localhost/v1"])
def test_reject_internal_llm_addresses(url):
    with pytest.raises(ModelError):
        validate_url(url)


def test_connect_time_dns_rebinding_guard(monkeypatch):
    monkeypatch.setattr("socket.getaddrinfo", lambda *a, **k: [(None, None, None, None, ("127.0.0.1", 80))])
    with patch.object(httpcore.SyncBackend, "connect_tcp", side_effect=AssertionError("must not open socket")), pytest.raises(httpcore.ConnectError):
        PublicModelBackend(()).connect_tcp("public.example", 80)
    assert allowed_address("internal.example", "10.0.0.1", ("internal.example",))
    assert allowed_address("other", "10.0.0.1", ("10.0.0.0/24",))
    assert not allowed_address("other", "10.0.1.1", ("10.0.0.0/24",))


def test_transport_pins_ip_and_preserves_tls_and_host(monkeypatch):
    events = []
    class Stream(httpcore.NetworkStream):
        def read(self, max_bytes, timeout=None):
            return b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK"
        def write(self, buffer, timeout=None):
            events.append(buffer)
        def close(self):
            pass
        def start_tls(self, ssl_context, server_hostname=None, timeout=None):
            events.append(server_hostname)
            return self
        def get_extra_info(self, info):
            return None
    def connect(self, host, *args, **kwargs):
        events.append(host)
        return Stream()
    monkeypatch.setattr("socket.getaddrinfo", lambda *a, **k: [(None, None, None, None, ("8.8.8.8", 443))])
    monkeypatch.setattr(httpcore.SyncBackend, "connect_tcp", connect)
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:1")
    with model_client(httpx.Timeout(2), (), None) as client:
        assert client.get("https://public.example/models").text == "OK"
    assert events[:2] == ["8.8.8.8", "public.example"]
    assert any(isinstance(event, bytes) and b"Host: public.example" in event for event in events)


def test_comparison_target_canonicalization(platform, monkeypatch):
    job = SimpleNamespace(id="case", algorithm="fot-records", config={"case": {"opening": "Synthetic"}, "max_steps": 10,
                          "evidence": {"ask": {}, "exam": {"Vital_Signs": "Synthetic vitals"}, "test": {}}})
    monkeypatch.setattr(comparison_runtime, "_model", lambda *a: SimpleNamespace(chat=lambda *a, **k:
        SimpleNamespace(text='{"action":"exam","target":"vital_signs","text":"查体"}')))
    result, target = comparison_runtime.next_step(platform, job, None, "baseline", [], set())
    assert target == "Vital_Signs" and result.result == "Synthetic vitals"


def test_active_comparison_and_evaluation_prevent_model_deletion(platform, client):
    for kind in (m.CONSULTATION_COMPARISON, "medical-records"):
        endpoint = client.post("/v1/endpoints", json={"name": "Review", "baseUrl": "https://public.example", "models": ["review"]}).json()["id"]
        with platform.db.session() as session:
            row = task(endpoint, status="queued")
            row.task_type = kind
            row.config = {"model": f"{endpoint}:review"}
            session.add(row)
        assert client.delete(f"/v1/endpoints/{endpoint}").status_code == 409


def test_frozen_cases_digest_and_legacy(platform):
    cases = [{"input": {"patient": "synthetic"}, "reference": "diagnosis", "site_id": "one"}]
    job = task("frozen", status="queued")
    job.config = frozen_cases.freeze(platform, job.id, cases)
    assert "input" not in job.config["case_index"][0] and frozen_cases.load(platform, job) == cases
    (platform.settings.runs_dir / job.id / job.config["cases_path"]).write_text("tampered")
    from fedagent.errors import ServiceError
    with pytest.raises(ServiceError):
        frozen_cases.load(platform, job)
    job.config = {"cases": cases}
    assert frozen_cases.load(platform, job) == cases


def test_old_package_can_use_new_evaluator_and_details_are_paginated(platform, client):
    from test_experience import completed

    from fedagent.experience import package_evaluation
    source, _ = completed(platform, client, "fot-records", cases_per_site=14)
    published = client.post("/v1/apps", json={"taskId": source, "builtAfterRound": 1, "name": "Review"}).json()
    with platform.db.session() as session:
        session.get(m.Task, source).plugin_hash = "prior-generation-hash"
    response = client.post("/v1/evaluations", json={"packageId": published["id"], "model": "fake:fake"})
    assert response.status_code == 201, response.text
    job_id = response.json()["id"]
    with platform.db.session() as session:
        job = package_evaluation.get(session, job_id)
        assert job.config["consumer_hash"] == platform.registry.algorithm("fot-records").code_hash()
        assert job.config["scoring_version"] and "cases" not in job.config
        job.status = "completed"
        for index, case in enumerate(frozen_cases.index(job)):
            for arm in ("none", "federated"):
                session.add(m.Report(task_id=job.id, round=1, step=arm, site_id=case["site_id"], unit_key=str(index),
                                     name="experience-evaluation", value={"correct": arm == "federated"}))
    summary = client.get(f"/v1/evaluations/{job_id}?includeCases=false").json()
    assert summary["total"] == 28 and summary["cases"] == [] and summary["changes"]["improved"] == 28
    first = client.get(f"/v1/evaluations/{job_id}/cases?change=improved&offset=0&limit=12").json()
    second = client.get(f"/v1/evaluations/{job_id}/cases?change=improved&offset=12&limit=12").json()
    assert first["total"] == 28 and len(first["cases"]) == len(second["cases"]) == 12
    assert first["cases"][-1] != second["cases"][0]
    assert client.get(f"/v1/evaluations/{job_id}/cases?change=worsened").json()["cases"] == []


@pytest.mark.parametrize("name", ["Hodgkin lymphoma, nodular sclerosis type", "Hypertension, not otherwise specified", "ST-elevation / anterior MI"])
def test_qualified_diagnosis_name_is_accepted(name):
    from fedagent_evomed.grading import diagnosis_name
    assert diagnosis_name(name) == name


@pytest.mark.parametrize("reply", ["Score: [0.9]", "0.85", "Clinical equivalent [0.85]", "Score: 0.85"])
def test_score_formatting_preserves_clinical_threshold(reply):
    assert DiagnosisClinicalGrader().evaluate("Hansen disease", {"answer": "Leprosy"}, Judge(reply))


def test_network_uses_next_validated_address(monkeypatch):
    monkeypatch.setattr("socket.getaddrinfo", lambda *a, **k: [
        (None, None, None, None, ("2606:4700:4700::1111", 443)), (None, None, None, None, ("8.8.8.8", 443))])
    seen = []
    stream = object()
    def connect(self, host, *args, **kwargs):
        seen.append(host)
        if len(seen) == 1:
            raise httpcore.ConnectError("unreachable v6")
        return stream
    monkeypatch.setattr(httpcore.SyncBackend, "connect_tcp", connect)
    assert PublicModelBackend(()).connect_tcp("public.example", 443, timeout=2) is stream
    assert seen == ["2606:4700:4700::1111", "8.8.8.8"]


def test_labeled_application_grades_the_diagnosis_only(platform, client, monkeypatch):
    from fedagent_sdk import ApplyResult
    from test_experience import completed
    from test_process_records import record
    source, _ = completed(platform, client, "fot-records")
    published = client.post("/v1/apps", json={"taskId": source, "builtAfterRound": 1, "name": "Review"}).json()
    algorithm = platform.registry.algorithm("fot-records")
    monkeypatch.setattr(algorithm, "apply", lambda *a: ApplyResult("Pneumonia\nOther diseases were excluded.", details={"diagnosis": "Pneumonia"}))
    predictions = []
    def grade(prediction, *args):
        predictions.append(prediction)
        return prediction == "Pneumonia"
    monkeypatch.setattr(platform.registry.grader("diagnosis-clinical"), "evaluate", grade)
    response = client.post(f"/v1/apps/{published['id']}/invoke", json={"model": "fake:fake", "input": record(True)["input"], "answer": "Pneumonia"})
    assert response.status_code == 200 and response.json()["correct"] is True
    assert predictions == ["Pneumonia"]


@pytest.mark.parametrize("host", ["127.0.0.1", "public-looking.example"])
def test_pre_task_connectivity_uses_the_guarded_network(platform, client, monkeypatch, host):
    from fedagent.checks.connectivity import model_connection
    created = client.post("/v1/endpoints", json={"name": "Guard", "baseUrl": "https://public.example", "models": ["review"]})
    endpoint_id = created.json()["id"]
    with platform.db.session() as session:
        session.get(m.Endpoint, endpoint_id).base_url = f"http://{host}/v1"
    monkeypatch.setattr("socket.getaddrinfo", lambda *a, **k: [(None, None, None, None, ("127.0.0.1", 80))])
    with patch.object(httpcore.SyncBackend, "connect_tcp", side_effect=AssertionError("must not open socket")), pytest.raises(ModelError):
        model_connection(platform, endpoint_id)


def test_truncated_model_stream_remains_retryable():
    from fedagent.model_network import ModelResponseStream
    def truncated():
        yield b"data: partial\n"
        raise httpcore.RemoteProtocolError("synthetic truncated stream")
    response = httpcore.Response(200, content=truncated())
    with pytest.raises(httpx.TransportError):
        list(ModelResponseStream(response))
