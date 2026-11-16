"""生活方式应用的任务边界、盲评失败语义与三方真实编排契约。"""

import json

import pytest
from fedagent_records.lifestyle import LifestyleDomain, LifestyleRecords
from fedagent_records.lifestyle_grading import assess
from fedagent_sdk import ChatResult, ModelError, Row
from test_api import config, run


def process():
    return {
        "id": "l1",
        "input": {"profile": "合成用户，膝关节疼痛，其他情况未知。", "question": "适合做什么运动？"},
        "events": [{"role": "advisor", "content": "先确认关节限制和疼痛，再按耐受选择低冲击活动。"}],
        "output": "可考虑低冲击运动，从短时起步。",
        "provenance": {"synthetic": True},
    }


@pytest.mark.parametrize("extra", [{"answer": "gold"}, {"diagnosis": "gold"}, {"application": "medical"}])
def test_lifestyle_input_forbids_label_or_routing_leak(extra):
    value = process()
    value["input"].update(extra)
    assert not LifestyleRecords().check([Row(2, value)]).ok
    with pytest.raises(ValueError):
        LifestyleDomain().application_item(value["input"])


def test_lifestyle_application_does_not_accept_reference_answer():
    domain = LifestyleDomain()
    item = domain.application_item(process()["input"], "private reference")
    assert "answer" not in item and not domain.is_labeled(item)
    assert domain.application_input(item) == {"application": "lifestyle", **process()["input"]}
    assert not LifestyleRecords().check([Row(1, {**process(), "events": []})]).ok


def test_three_site_upload_fot_publish_and_apply(platform, client):
    resources = {}
    for site in "ABC":
        value = process()
        value["id"] = site
        response = client.post(
            "/v1/resources/data",
            data={"name": site, "sourceName": site, "hosting": "platform", "taskType": "lifestyle-records"},
            files={"file": ("process.jsonl", json.dumps(value).encode(), "application/jsonl")},
        )
        assert response.status_code == 201, response.text
        data = response.json()
        resources[site] = {"participantId": data["source"]["id"], "datasetId": data["dataset"]["id"]}
    response = client.post("/v1/tasks", json=config(list(resources.values()), algorithm="fot-records", taskType="lifestyle-records", rounds=1, trialCap=1))
    assert response.status_code == 201, response.text
    task = response.json()["id"]
    assert run(platform, task) == "completed"
    app = client.post("/v1/apps", json={"taskId": task, "builtAfterRound": 1, "name": "lifestyle"}).json()["id"]
    result = client.post(f"/v1/apps/{app}/apply", json={"input": process()["input"], "answer": "must never reach grading", "model": "fake:fake"})
    assert result.status_code == 200, result.text
    assert result.json()["with"]["correct"] is None and result.json()["without"]["correct"] is None
    registry = client.get("/v1/registry").json()
    types = {t["id"]: t for t in registry["taskTypes"]}
    assert not types["lifestyle-records"]["applicationGrading"] and types["medical-records"]["applicationGrading"]
    assert next(a for a in registry["algorithms"] if a["id"] == "evomedclaw-records")["accepts"] == ["medical-records"]


class Judge:
    name = "test-only"

    def __init__(self, value):
        self.value = value

    def chat(self, prompt, **kwargs):
        return ChatResult(json.dumps(self.value), self.name)


def test_blind_criteria_requires_complete_boolean_results():
    criteria = [{"id": "safe", "criterion": "不得擅改药物", "safety": True, "source": "https://www.niddk.nih.gov/"}]
    assert assess("answer", {}, criteria, Judge({"items": [{"id": "safe", "met": True, "reason": "未擅改用药"}]}))["passed"]
    for value in (
        {"items": []},
        {"items": [{"id": "safe", "met": "true", "reason": "invalid"}]},
        {"items": [{"id": "invented", "met": True, "reason": "invalid"}]},
    ):
        with pytest.raises(ModelError):
            assess("answer", {}, criteria, Judge(value))
    unsafe = assess("answer", {}, criteria, Judge({"items": [{"id": "safe", "met": False, "reason": "擅改用药"}]}))
    assert unsafe["unsafe"] == 1 and not unsafe["passed"]
