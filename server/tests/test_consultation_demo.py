import json

from fedagent_sdk import ChatResult, ModelError

from fedagent.model_runtime import GatewayModel


def test_demo_final_diagnosis_and_independent_grading(platform, client, monkeypatch):
    samples = client.get("/v1/consultation/samples").json()
    assert [sample["packageName"] for sample in samples] == ["EvoMedClaw", "FoT"]
    assert all(set(sample) == {"packageName", "turns"} and len(sample["turns"]) == 3 for sample in samples)
    assert "Bartter syndrome" not in json.dumps(samples)
    texts = [turn["text"] for turn in samples[1]["turns"]]
    assert len(texts) == 3
    responses = {"normal": {"department": "儿科", "output": "请补充检查资料。", "suggestions": []},
                 "final": {"department": "儿科", "output": "结合病史和检查。", "diagnosis": "Bartter 综合征"}}
    scored = []

    def reply(self, messages, **kwargs):
        data = json.loads(messages[1]["content"])
        assert set(data) == {"dialogue", "experience"} and data["experience"] == {}
        assert "Bartter syndrome" not in json.dumps(messages)
        final = "final turn of a preset teaching case" in messages[0]["content"]
        return ChatResult(text=json.dumps(responses["final" if final else "normal"], ensure_ascii=False), model=self.name)

    def grade(diagnosis, item, model):
        assert item == {"answer": "Bartter syndrome"}
        assert model.purpose == "consultation-grade"
        scored.append(diagnosis)
        if diagnosis == "模型判分服务异常":
            raise ModelError("mock grade failure")
        return diagnosis.startswith("Bartter 综合征")

    monkeypatch.setattr(GatewayModel, "chat", reply)
    monkeypatch.setattr(platform.registry.grader("diagnosis-clinical"), "evaluate", grade)

    def submit(turns):
        messages = []
        for text in turns:
            if messages:
                messages.append({"role": "assistant", "content": "请补充检查资料。"})
            messages.append({"role": "user", "content": text})
        return client.post("/v1/consultation/chat", json={"model": "fake:fake", "messages": messages})

    assert "final" not in submit(texts[:2]).json()
    assert "final" not in submit([*texts[:2], texts[2] + "另有新的症状。"]).json()
    assert scored == []

    assert submit(texts).json()["final"] == {
        "caseLabel": samples[1]["turns"][0]["label"], "diagnosis": "Bartter 综合征",
        "reference": "Bartter 综合征", "matched": True,
    }

    bilingual = "Bartter 综合征（Bartter syndrome, type III）"
    responses["final"]["diagnosis"] = bilingual
    assert submit(texts).json()["final"]["matched"] is True

    responses["final"]["diagnosis"] = "Gitelman 综合征"
    assert submit(texts).json()["final"]["matched"] is False

    responses["final"]["diagnosis"] = "模型判分服务异常"
    unavailable = submit(texts).json()["final"]
    assert unavailable["diagnosis"] == "模型判分服务异常" and unavailable["matched"] is None

    responses["final"]["diagnosis"] = "Bartter 综合征或 Gitelman 综合征"
    assert submit(texts).status_code == 502
    assert scored == ["Bartter 综合征", bilingual, "Gitelman 综合征", "模型判分服务异常"]
