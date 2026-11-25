import json

import pytest

from tools.lifestyle import model as bridge
from tools.lifestyle.batch_tests.test_federation import FakeModel
from tools.lifestyle.diet_trial import prepare as preparation
from tools.lifestyle.diet_trial.protocol import CRITERIA
from tools.lifestyle.sensor_trial import prepare as sensor_preparation
from tools.lifestyle.sensor_trial_tests.conftest import IDENTITY
from tools.lifestyle.sensor_trial_tests.conftest import job as make_sensor_job


@pytest.fixture
def job(tmp_path, monkeypatch):
    old, source, _ = make_sensor_job.__wrapped__(tmp_path, monkeypatch)
    monkeypatch.setattr(preparation, "SOURCE_POLICY", sensor_preparation.SOURCE_POLICY)
    monkeypatch.setattr(preparation, "protected_files", lambda *args: {})
    directory = old.parent / "diet-trial"
    return directory, preparation.prepare(directory, source, IDENTITY)


@pytest.fixture
def remote(monkeypatch):
    state = {"paid": 0, "inspect": 0, "requests": [], "outage": False, "invalidJudge": 0, "upstreamErrors": 0}
    fake = FakeModel()

    def call(request):
        if request.get("inspect"):
            state["inspect"] += 1
            return IDENTITY
        state["paid"] += 1
        state["requests"].append(request)
        if state["outage"]:
            from fedagent_sdk import ModelError

            raise ModelError("test unknown-cost failure")
        if state["upstreamErrors"]:
            from tools.lifestyle.sensor_trial.transport import UpstreamReplyError

            state["upstreamErrors"] -= 1
            raise UpstreamReplyError("test completed error event")
        system = request["messages"][0]["content"]
        if system.startswith("DIET_BLIND_JUDGE_V1"):
            cases = json.loads(request["messages"][1]["content"])["cases"]
            if state["invalidJudge"]:
                state["invalidJudge"] -= 1
                text = "{}"
            else:
                text = json.dumps(
                    {
                        "cases": [
                            {
                                "id": c["id"],
                                "answers": {
                                    label: {
                                        k: {"pass": True, "evidence": "未发现该风险" if k.startswith("S") else answer[:12]}
                                        for k in CRITERIA
                                    }
                                    for label, answer in c["answers"].items()
                                },
                            }
                            for c in cases
                        ]
                    }
                )
        elif system.startswith("DIET_ADVICE_V1"):
            text = "测试建议：核实份量；蔬菜配蛋白和全谷，记录饱腹感，不能预测血糖。"
        else:
            result = fake.chat(request["messages"], **request["settings"])
            text = result.text
        return {"text": text, "model": "test", "usage": {"prompt_tokens": 1, "completion_tokens": 1}, "finish_reason": "stop"}

    monkeypatch.setattr(bridge, "remote", call)
    return state
