"""原版判分与评测隔离的回归；不依赖真实模型。"""
import pytest
from fedagent_evomed.grading import DiagnosisClinicalGrader
from fedagent_evomed.medical import DiagnosisExactGrader
from fedagent_sdk import ChatResult, ModelError


class Judge:
    name = "judge"

    def __init__(self, reply="[0.85]", error=None):
        self.reply, self.error, self.prompts = reply, error, []

    def chat(self, prompt, **kwargs):
        self.prompts.append(prompt)
        if self.error:
            raise self.error
        return ChatResult(self.reply, self.name, {"prompt_tokens": 7, "completion_tokens": 3})


@pytest.mark.parametrize("prediction", ["Paucibacillary tuberculoid leprosy",
    "Borderline lepromatous Hansen disease (multibacillary leprosy)"])
def test_subtype_diagnoses_use_clinical_equivalence(prediction):
    model = Judge()
    assert DiagnosisClinicalGrader().evaluate(prediction, {"answer": "Leprosy"}, model)
    assert len(model.prompts) == 1
    assert not DiagnosisExactGrader().grade(prediction, {"answer": "Leprosy"})


@pytest.mark.parametrize("score,expected", [("[0.75]", True), ("[0.74]", False), ("[0.1]", False)])
def test_original_moderator_prompt_and_threshold(score, expected):
    model = Judge(score)
    assert DiagnosisClinicalGrader().evaluate("Hansen disease", {"answer": "Leprosy"}, model) is expected
    assert len(model.prompts) == 1
    assert "CLINICAL EQUIVALENCE" in model.prompts[0][0]["content"]
    assert "Leprosy" in model.prompts[0][1]["content"]


@pytest.mark.parametrize("reply", ["", "could not judge", "[NaN]", "[1.2]"])
def test_malformed_judgment_never_becomes_a_wrong_diagnosis(reply):
    with pytest.raises(ModelError):
        DiagnosisClinicalGrader().evaluate("Hansen disease", {"answer": "Leprosy"}, Judge(reply))


def test_timeout_and_missing_model_are_not_zero():
    with pytest.raises(ModelError, match="timeout"):
        DiagnosisClinicalGrader().evaluate("Hansen disease", {"answer": "Leprosy"}, Judge(error=ModelError("timeout")))
    with pytest.raises(ModelError, match="评测模型"):
        DiagnosisClinicalGrader().grade("Hansen disease", {"answer": "Leprosy"})
    assert not DiagnosisClinicalGrader().grade("", {"answer": "Leprosy"})


def test_learning_marks_subtype_diagnosis_success_in_trajectory_and_cards(monkeypatch):
    from fedagent_evomed import EvoMedClaw
    from fedagent_evomed.medical import MedicalDiagnosis
    from fedagent_evomed.site import compile_experience, learn

    from fedagent.agents.protocol import AgentRequest, SavedValue
    from fedagent.agents.runtime import context_of
    from fedagent.data import to_item

    algorithm = EvoMedClaw()
    case = {"id": "learn", "patient": "Local test only", "objective": "Diagnose", "answer": "Leprosy", "split": "learn"}
    prediction = "DIAGNOSIS READY: Paucibacillary tuberculoid leprosy"
    result = {"is_correct": False, "predicted_diagnosis": prediction, "dialogue_history": [
        {"speaker": "LocalDoctor", "text": prediction, "turn_index": 0}], "consultation_history": []}
    monkeypatch.setattr("fedagent_evomed.site.diagnose", lambda *args, **kw: (result.copy(), {}))
    request = AgentRequest(run_id="learning-test", algorithm="evomedclaw", version=algorithm.version,
        task_type="medical-diagnosis", task_id="local-test", site_id="one", role="participant", round=2, rounds=3,
        step="learn", unit_key="learn", params={"maxTurns": 4}, items=[to_item(MedicalDiagnosis(), case, labels=True)])
    ctx = context_of(request, algorithm, Judge())
    learn(ctx)
    kept = {key: value for key, _, value in ctx.result.kept}
    assert kept["diagnostic_trajectory"]["is_correct"] is True
    request = request.model_copy(update={"step": "compile", "unit_key": "_",
                                         "state": [SavedValue(key=k, item_id=i, round=2, value=v) for k, i, v in ctx.result.kept]})
    ctx = context_of(request, algorithm)
    compile_experience(ctx, algorithm.version)
    kept = {key: value for key, _, value in ctx.result.kept}
    cards = kept["local_card_bank"]["cards"]
    assert cards and all(card["memory_type"] != "error_card" for card in cards)


def test_failed_central_grading_pauses_without_recording_false_scores(platform, client, remote, monkeypatch):
    import json

    from intake_helpers import verify_resources
    from sqlalchemy import select
    from test_api import run
    from test_medical import cases, medical_agents, medical_config, raw

    from fedagent import models as m
    from fedagent.model_runtime import GatewayModel

    chosen = []
    for participant in ("p-a", "p-b"):
        rows = cases()
        rows[1]["answer"] = "LABEL-CANARY-EVAL"
        made = client.post('/v1/datasets', data={'participantId': participant, 'name': '评分测试',
            'scenario': 'horizontal', 'taskType': 'medical-diagnosis'}, files={'file': ('cases.jsonl', raw(rows))})
        assert made.status_code == 201
        chosen.append({'participantId': participant, 'datasetId': made.json()['id']})
    config = medical_config(chosen)
    config.update(execution="agent", agentId=remote[0])
    medical_agents(client, config, remote[0])
    verify_resources(client, config)
    check = client.post('/v1/task-checks', json=config).json()
    config['checkId'] = check['id']
    task = client.post('/v1/tasks', json=config).json()
    original = GatewayModel._fake
    monkeypatch.setattr(GatewayModel, '_fake', lambda model, text, digest:
        'invalid judgment' if model.purpose == 'grade' else original(model, text, digest))
    assert run(platform, task['id']) == 'paused'
    with platform.db.session() as db:
        assert not list(db.scalars(select(m.Report).where(m.Report.task_id == task['id'], m.Report.name == 'correct')))
        assert list(db.scalars(select(m.CallRecord).where(m.CallRecord.task_id == task['id'], m.CallRecord.purpose == 'grade')))
    diagnoses = [r for r in remote[1] if r.task_id == task['id'] and r.step == 'diagnose']
    assert diagnoses and all('LABEL-CANARY-EVAL' not in json.dumps(r.model_dump(mode='json')) for r in diagnoses)
