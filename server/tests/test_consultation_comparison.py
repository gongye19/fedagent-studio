import json
from threading import Event, Thread

import pytest
from fedagent_sdk import ChatResult, ModelError
from test_experience import completed

from fedagent import models as m
from fedagent.experience import comparison_case, consultation_comparison
from fedagent.model_runtime import GatewayModel

BASE = "/v1/consultation/comparisons"
CASE = {
    "id": comparison_case.CASE.id,
    "answer": "Bartter's syndrome",
    "patient": {"History": "Longstanding fatigue", "Past_Medical_History": "Case note mentions Bartter's syndrome"},
    "examination": {"Vital_Signs": "Blood pressure 110/75"},
    "tests": {"Serum_Electrolytes": "Potassium 3.2 mEq/L"},
}


@pytest.fixture
def setup(platform, client, monkeypatch):
    source, _ = completed(platform, client, "fot-records")
    response = client.post("/v1/apps", json={"taskId": source, "builtAfterRound": 1, "name": "FoT"})
    assert response.status_code == 201, response.text
    provenance = {"sourceHash": "a" * 64, "sourceIndex": 0}
    load = platform.files.load

    def training(path):
        return [dict(row, provenance=provenance) for row in load(path)]

    monkeypatch.setattr(platform.files, "load", training)
    monkeypatch.setattr(comparison_case, "load_case", lambda platform, case_id: CASE)
    monkeypatch.setattr(consultation_comparison, "load_case", lambda platform, case_id: CASE)
    return {"caseId": CASE["id"], "packageId": response.json()["id"], "model": "fake:fake"}, provenance


def run(platform, job_id):
    with platform.db.session() as session:
        job = consultation_comparison.get(session, job_id)
        job.status = "running"
    return consultation_comparison.run(platform, job)


def test_requires_source_disjointness_and_hides_comparison_from_tasks(platform, client, setup):
    body, provenance = setup
    assert client.get("/v1/consultation/comparison-cases").json()[0]["id"] == CASE["id"]
    provenance.update(sourceHash=comparison_case.SOURCE_SHA256, sourceIndex=comparison_case.SOURCE_INDEX)
    assert client.post(BASE, json=body).status_code == 422
    provenance.clear()
    assert client.post(BASE, json=body).status_code == 409
    provenance.update(sourceHash="a" * 64, sourceIndex=0)
    result = client.post(BASE, json=body)
    assert result.status_code == 201, result.text
    result = result.json()
    url = f"{BASE}/{result['id']}"
    assert "reference" not in result
    assert client.get(f"{BASE}/active").json()["id"] == result["id"]
    assert client.post(BASE, json=body).status_code == 409
    assert not any(task["id"] == result["id"] for task in client.get("/v1/tasks").json())
    assert client.get(f"/v1/tasks/{result['id']}").status_code == 404
    assert client.get(f"/v1/tasks/{result['id']}/messages").status_code == 404
    assert client.post(f"/v1/tasks/{result['id']}/cancel").status_code == 404
    stopped = client.post(f"{url}/cancel").json()
    assert stopped["status"] == "canceled" and "reference" not in stopped
    assert client.get(f"{BASE}/active").json() is None


def test_independent_actions_resume_and_reveal_after_both_finish(platform, client, monkeypatch, setup):
    body, _ = setup
    response = client.post(BASE, json=body)
    assert response.status_code == 201, response.text
    job_id = response.json()["id"]
    interrupted = False
    ready = Event()
    release = Event()
    calls = []

    def reply(self, messages, **kwargs):
        nonlocal interrupted
        key = self.ledger
        payload = json.loads(messages[-1]["content"])
        calls.append((key.site_id, key.unit_key, payload))
        assert self.name == "fake"
        assert payload["opening"] == comparison_case.CASE.opening
        assert "bartter" not in messages[-1]["content"].casefold()
        assert bool(payload["experience"]) == (key.site_id == "experience")
        actions = ([("ask", "Past_Medical_History", "有既往病史吗？"), ("diagnosis", "", "其他诊断")]
                   if key.site_id == "baseline" else [
                       ("exam", "Vital_Signs", "测量生命体征"), ("test", "Serum_Electrolytes", "查血电解质"),
                       ("diagnosis", "", "Bartter 综合征"),
                   ])
        index = int(key.unit_key.split(":")[0])
        assert len(payload["observations"]) == index
        if key.site_id == "baseline" and index == 1:
            assert payload["observations"][0]["result"] == "Case note mentions [redacted]"
            if not interrupted:
                interrupted = True
                raise ModelError("temporary")
            ready.set()
            assert release.wait(10)
        if key.site_id == "experience" and index == 1:
            assert payload["observations"][0]["result"] == "Blood pressure 110/75"
            assert "Potassium" not in messages[-1]["content"]
        action, target, text = actions[index]
        return ChatResult(json.dumps(dict(action=action, target=target, text=text)), model=self.name)

    def score(prediction, item, model):
        assert item == {"answer": CASE["answer"]}
        return prediction == "Bartter 综合征"

    monkeypatch.setattr(GatewayModel, "chat", reply)
    monkeypatch.setattr(platform.registry.grader("diagnosis-clinical"), "evaluate", score)
    assert run(platform, job_id) == "paused"
    url = f"{BASE}/{job_id}"
    before = client.get(url).json()
    assert "reference" not in before and all("diagnosis" not in arm for arm in before["arms"])
    assert before["arms"][0]["steps"][0]["action"] == "ask"
    assert client.post(f"{url}/resume").status_code == 200
    outcomes = []
    thread = Thread(target=lambda: outcomes.append(run(platform, job_id)))
    thread.start()
    try:
        assert ready.wait(10)
        assert "reference" not in client.get(url).json()
    finally:
        release.set()
        thread.join(10)
    assert outcomes == ["completed"]
    after = client.get(url).json()
    assert after["reference"] == "Bartter 综合征"
    assert [arm["matched"] for arm in after["arms"]] == [False, True]
    assert [[step["action"] for step in arm["steps"]] for arm in after["arms"]] == [["ask"], ["exam", "test"]]
    assert sum((arm, key) == ("baseline", "0:0") for arm, key, _ in calls) == 1


def test_action_limit_finishes_without_inventing_diagnosis(platform, client, monkeypatch, setup):
    body, _ = setup
    monkeypatch.setattr(consultation_comparison, "MAX_STEPS", 2)
    monkeypatch.setattr(GatewayModel, "chat", lambda self, *_args, **_kwargs: ChatResult(json.dumps({
        "action": "test", "target": self.ledger.unit_key, "text": "病例外的检验",
    }), model=self.name))
    response = client.post(BASE, json=body)
    assert response.status_code == 201, response.text
    job_id = response.json()["id"]
    assert run(platform, job_id) == "completed"
    item = client.get(f"{BASE}/{job_id}").json()
    assert item["reference"]
    for arm in item["arms"]:
        assert arm["status"] == "limit" and "matched" not in arm and "diagnosis" not in arm
        assert len(arm["steps"]) == 2 and arm["steps"][0]["result"] == "病例未提供该项资料"


def test_case_installation_requires_pinned_content(platform, client):
    assert client.get("/v1/consultation/comparison-cases").json() == []
    directory = platform.settings.data_dir / "consultation-cases"
    directory.mkdir()
    (directory / f"{CASE['id']}.json").write_text(json.dumps(CASE))
    assert client.get("/v1/consultation/comparison-cases").json() == []
    with platform.db.session() as session:
        assert session.query(m.Task).count() == 0


def test_grading_failure_retries_only_unscored_diagnosis(platform, client, monkeypatch, setup):
    body, _ = setup
    calls = []
    grades = []

    def reply(self, *_args, **_kwargs):
        calls.append(self.ledger.site_id)
        return ChatResult('{"action":"diagnosis","text":"Bartter 综合征"}', model=self.name)

    def score(_prediction, _item, model):
        grades.append(model.ledger.site_id)
        if grades == ["baseline", "experience"]:
            raise ModelError("temporary grading error")
        return True

    monkeypatch.setattr(GatewayModel, "chat", reply)
    monkeypatch.setattr(platform.registry.grader("diagnosis-clinical"), "evaluate", score)
    response = client.post(BASE, json=body)
    assert response.status_code == 201, response.text
    job_id = response.json()["id"]
    url = f"{BASE}/{job_id}"
    assert run(platform, job_id) == "paused"
    pending = client.get(url).json()
    assert [arm["status"] for arm in pending["arms"]] == ["diagnosed", "diagnosed"]
    assert "reference" not in pending and all("matched" not in arm for arm in pending["arms"])
    assert client.post(f"{url}/resume").status_code == 200
    assert run(platform, job_id) == "completed"
    assert [arm["matched"] for arm in client.get(url).json()["arms"]] == [True, True]
    assert sorted(calls) == ["baseline", "experience"]
    assert grades == ["baseline", "experience", "experience"]
