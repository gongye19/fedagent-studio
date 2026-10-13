"""跨任务类型上传／应用，以及 EvoMedClaw 的实际编排和数据边界。"""
from __future__ import annotations

import copy
import json
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from fedagent_client.worker import ClientConfig, Worker
from fedagent_evomed.bridge import diagnose
from fedagent_evomed.medical import MedicalDiagnosis
from fedagent_sdk import ChatResult, ModelError, TaskType
from sqlalchemy import select
from test_api import run

from fedagent import models as m
from fedagent.engine import TaskEngine
from fedagent.platform import Platform
from fedagent.testing import run_contract


def cases():
    return [
        {"id": "learn-private", "patient": "Recurrent unilateral headache with photophobia, migraine features.",
         "objective": "Identify the most likely diagnosis.", "tests": {"neurological examination": "normal"}, "answer": "migraine", "split": "learn"},
        {"id": "eval-private", "patient": "EVALUATION-ONLY: headache episodes for a different patient with nausea and light sensitivity.",
         "objective": "Identify the most likely diagnosis.", "answer": "migraine", "split": "eval"},
    ]


def raw(rows):
    return "".join(json.dumps(row) + "\n" for row in rows).encode()


def medical_dataset(client: TestClient, pid: str):
    response = client.post('/v1/datasets', data={
        'participantId': pid, 'name': '医疗测试数据', 'scenario': 'horizontal', 'taskType': 'medical-diagnosis',
    }, files={'file': ('medical.jsonl', raw(cases()))})
    assert response.status_code == 201, response.text
    return response.json()['id']


def medical_config(chosen):
    return {'name': '医疗测试任务', 'scenario': 'horizontal', 'taskType': 'medical-diagnosis', 'algorithm': 'evomedclaw',
            'participants': chosen, 'clientModel': 'fake:fake', 'serverModel': 'absent:model', 'rounds': 2, 'trialCap': 2,
            'params': {'maxTurns': 4}}


def test_medical_upload_and_template(client):
    checked = client.post('/v1/datasets/check', data={'taskType': 'medical-diagnosis'}, files={'file': ('x.jsonl', raw(cases()))}).json()
    assert checked['ok'] and checked['count'] == 2
    assert checked['sample']['fields'][0]['label'] == '病人信息'
    assert client.get('/v1/task-types/medical-diagnosis/template').headers['content-type'].startswith('application/x-ndjson')
    template = client.get('/v1/task-types/medical-diagnosis/template').text
    assert '"patient"' in template and '"question"' not in template and 'migraine' not in template
    assert client.post('/v1/datasets/check', data={'taskType': 'missing'}, files={'file': ('x.jsonl', raw(cases()))}).status_code == 422
    invalid = cases()
    invalid[-1]['tests'] = []
    before = client.get('/v1/participants').json()
    failed = client.post('/v1/participants', data={'name': '不应保存', 'hosting': 'platform', 'datasetName': 'x',
                          'scenario': 'horizontal', 'taskType': 'medical-diagnosis'}, files={'file': ('x.jsonl', raw(invalid))})
    assert failed.status_code == 422 and client.get('/v1/participants').json() == before
    assert failed.json()['detail']['check']['problems'][0]['line'] == 2


def test_osce_conversion_and_nested_labels():
    plugin = MedicalDiagnosis()
    rows = []
    for item in cases():
        rows.append({'OSCE_Examination': {'Patient_Actor': item['patient'], 'Objective_for_Doctor': item['objective'],
                    'Test_Results': item.get('tests', {}), 'Correct_Diagnosis': item['answer']}})
    from fedagent.data import check_file
    report = check_file(plugin, raw(rows))
    assert report.ok and [item['split'] for item in report.items] == ['learn', 'eval']
    item = {**report.items[0], 'patient': {'history': 'headache', 'Correct_Diagnosis': 'LABEL-CANARY'}}
    original = copy.deepcopy(item)
    assert 'LABEL-CANARY' not in json.dumps(plugin.strip_labels(item))
    assert item == original
    class Nested(TaskType):
        label_fields = ('private.answer',)
    assert Nested().strip_labels({'private': {'answer': 'secret', 'history': 'text'}}) == {'private': {'history': 'text'}}
    assert Nested().is_labeled({'private': {'answer': 'secret'}})


def test_eval_leakage_is_rejected():
    from fedagent.data import check_file
    rows = cases()
    rows[1] = {**rows[0], 'id': 'different-id', 'split': 'eval'}
    checked = check_file(MedicalDiagnosis(), raw(rows))
    assert not checked.ok and '内容重复' in checked.issues[0].message


def test_diagnostic_agents_never_receive_reference_label():
    class Recorder:
        name = 'test'
        def __init__(self):
            self.prompts = []
        def chat(self, prompt, **kwargs):
            self.prompts.append(json.dumps(prompt))
            return ChatResult('DIAGNOSIS READY: migraine', 'test', {'prompt_tokens': 5, 'completion_tokens': 3})
    model = Recorder()
    case = MedicalDiagnosis().application_item({**cases()[0], 'answer': 'LABEL-CANARY', 'examination': 'normal exam', 'tests': 'normal tests'})
    result, usage = diagnose(MedicalDiagnosis().application_input(case), None, model, turns=4)
    assert result['num_turns'] == 1 and usage['prompt_tokens'] == 5
    assert all('LABEL-CANARY' not in prompt for prompt in model.prompts)


def test_unfinished_diagnosis_is_an_error():
    class QuestionOnly:
        name = 'question-only'
        def chat(self, prompt, **kwargs):
            return ChatResult('How long have the symptoms lasted?', self.name)
    with pytest.raises(ModelError, match='未形成最终诊断'):
        diagnose(MedicalDiagnosis().strip_labels(cases()[0]), None, QuestionOnly(), turns=4)


def test_medical_full_flow_and_single_invoke(client: TestClient, platform: Platform):
    chosen = [{'participantId': pid, 'datasetId': medical_dataset(client, pid)} for pid in ('p-a', 'p-b')]
    config = medical_config(chosen)
    invalid = client.post('/v1/tasks/validate', json={**config, 'trialCap': 1}).json()
    assert any('至少取 2' in x['message'] for x in invalid['issues'])
    created = client.post('/v1/tasks', json=config)
    assert created.status_code == 201, created.text
    task_id = created.json()['id']
    assert run(platform, task_id) == 'completed'
    task = client.get(f'/v1/tasks/{task_id}').json()
    assert all(member['answered'] == 1 for member in task['members'])
    assert task['rounds'][0]['correct'] == {'p-a': 1, 'p-b': 1}
    with platform.db.session() as session:
        messages = list(session.scalars(select(m.Message).where(m.Message.task_id == task_id)))
        serialized = json.dumps([message.payload for message in messages])
        assert 'EVALUATION-ONLY' not in serialized and 'learn-private' not in serialized and 'eval-private' not in serialized
        assert 'source_cases' not in serialized and 'minimal_rationale' not in serialized
    app = client.post('/v1/apps', json={'taskId': task_id, 'builtAfterRound': 2, 'name': '医疗测试应用'}).json()
    app_id = app['id']
    body = {'input': {**cases()[1], 'answer': 'LABEL-CANARY'}, 'answer': 'migraine', 'model': 'fake:fake'}
    invoked = client.post(f'/v1/apps/{app_id}/invoke', json=body)
    assert invoked.status_code == 200, invoked.text
    assert invoked.json()['correct'] and invoked.json()['details']['num_turns'] == 1
    compared = client.post(f'/v1/apps/{app_id}/apply', json=body).json()
    assert set(compared) == {'with', 'without'}
    exported = client.get(f'/v1/apps/{app_id}/export').json()
    assert exported['cards'] and exported['memory']['entries'] and 'heldout_lift' not in json.dumps(exported)
    invalid = client.post(f'/v1/apps/{app_id}/invoke', json={'input': 'math-like text', 'model': 'fake:fake'})
    assert invalid.status_code == 422
    with platform.db.session() as session:
        session.get(m.App, app_id).plugin_version = 'unavailable-version'
    assert client.post(f'/v1/apps/{app_id}/invoke', json=body).status_code == 409


def test_medical_contract_resume(tmp_path):
    report = run_contract('evomedclaw', datasets={'site-one': cases(), 'site-two': cases()}, workdir=tmp_path)
    assert report.ok, report
    assert report.details['artifacts'] == 2 and report.details['messages'] > 0


def test_local_medical_schema_and_plugin_capabilities(client: TestClient, platform: Platform, tmp_path: Path):
    participant = client.post('/v1/participants', data={'name': '本地医疗测试方', 'hosting': 'local', 'datasetName': '病例',
                                'scenario': 'horizontal', 'taskType': 'medical-diagnosis'}).json()
    pid = participant['id']
    did = client.get('/v1/datasets', params={'participant': pid}).json()[0]['id']
    token = client.post(f'/v1/participants/{pid}/client-tokens').json()['token']
    local = tmp_path/'cases.jsonl'
    local.write_bytes(raw(cases()))
    worker = Worker(ClientConfig(server='http://testserver', token=token, datasets={did: local}, state_path=tmp_path/'client.db', fake_model=True),
                    transport=client._transport)
    hello = worker.hello()
    assert hello['taskTypes'][did] == 'medical-diagnosis'
    assert worker.records[did]['learn-private']['split'] == 'learn'
    assert next(p for p in client.get('/v1/participants').json() if p['id'] == pid)['clientPlugins']['evomedclaw'] == '1.0.0'
    chosen = [{'participantId': 'p-a', 'datasetId': medical_dataset(client, 'p-a')}, {'participantId': pid, 'datasetId': did}]
    config = medical_config(chosen)
    assert client.post('/v1/tasks/validate', json=config).json()['issues'] == []
    created = client.post('/v1/tasks', json=config).json()
    task_id = created['id']
    with platform.db.session() as session:
        session.get(m.Task, task_id).status = 'running'
    result = {}
    thread = threading.Thread(target=lambda: result.setdefault('status', TaskEngine(platform, task_id, poll=0.01).run()))
    thread.start()
    deadline = time.monotonic() + 30
    while thread.is_alive() and time.monotonic() < deadline:
        if worker.run_once() == 0:
            time.sleep(0.02)
    thread.join(timeout=5)
    assert result.get('status') == 'completed'
    with platform.db.session() as session:
        assert not list(session.scalars(select(m.SiteState).where(m.SiteState.task_id == task_id, m.SiteState.site_id == pid)))
    assert client.get(f'/v1/tasks/{task_id}').json()['members'][1]['answered'] == 1
    client.post('/v1/client/hello', headers={'Authorization': f'Bearer {token}'}, json={'clientVersion': 'old', 'plugins': {'evomedclaw': '0.0'}})
    issues = client.post('/v1/tasks/validate', json=config).json()['issues']
    assert any('需要安装 EvoMedClaw' in x['message'] for x in issues)
    worker.http.close()


def test_local_model_resume_preserves_call_order(tmp_path):
    from fedagent_client.local import CachedUnitModel, LocalState
    class Counter:
        name = 'test-model'
        def __init__(self):
            self.calls = 0
        def chat(self, prompt, **kwargs):
            self.calls += 1
            return ChatResult(str(self.calls), self.name)
    model = Counter()
    state = LocalState(tmp_path/'cache.db')
    unit = {'taskId': 't', 'siteId': 'p', 'round': 1, 'step': 'diagnose', 'unitKey': 'case'}
    first = CachedUnitModel(model, state, unit, 'code')
    assert first.chat('same').text == '1'
    assert first.chat('same').text == '2'  # 同一单元里的重复请求仍是两次实际行动。
    replay = CachedUnitModel(model, state, unit, 'code')
    assert replay.chat('same').cached and replay.chat('same').text == '2'
    assert model.calls == 2
    changed = CachedUnitModel(model, state, unit, 'different-code')
    assert not changed.chat('same').cached and model.calls == 3


def test_diagnostic_consultation_path():
    class ProtocolModel:
        name = 'protocol-test'
        def __init__(self):
            self.doctor = 0
            self.prompts = []
        def chat(self, prompt, **kwargs):
            text = json.dumps(prompt)
            self.prompts.append(text)
            if 'local clinic doctor' in text:
                self.doctor += 1
                actions = ['How long has the headache lasted?', 'REQUEST TEST: neurological examination',
                           'REQUEST CONSULTATION:\nChief Complaint: recurrent headache\nKey Positive Findings: photophobia\n'
                           'Key Negative Findings: no focal deficit\nTests Performed: neurological examination\n'
                           'Working Differential: migraine\nSpecific Question: confirm the leading diagnosis',
                           'Any recent visual changes?', 'DIAGNOSIS READY: migraine']
                reply = actions[min(self.doctor-1, len(actions)-1)]
            else:
                reply = ('Assessment: episodic headache with photophobia\nDifferential Ranking: 1. migraine\n'
                         'Recommended Tests: review neurological examination\nRed Flags to Exclude: focal deficit')
            return ChatResult(reply, self.name)
    model = ProtocolModel()
    result, _ = diagnose(MedicalDiagnosis().strip_labels(cases()[0]), None, model, turns=8)
    assert result['num_tests'] == 1 and result['num_consultations'] == 1
    assert result['predicted_diagnosis'] == 'DIAGNOSIS READY: migraine'
    assert result['consultation_history']
    assert all('"answer"' not in prompt for prompt in model.prompts)
