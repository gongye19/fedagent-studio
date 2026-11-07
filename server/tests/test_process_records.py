"""新上传流程使用已发生的过程，不重新生成解答；平台内完成提取、聚合、发布和应用。"""
import json

import pytest
from fedagent_records.records import MathRecords, MedicalRecords
from fedagent_sdk import Row
from test_api import config, run


def record(medical=False):
    return {"id": "r1", "input": {"patient": "fever and cough", "objective": "diagnose", "tests": {}, "examination": {}} if medical else "Find x if 2x=4",
            "events": [{"role": "doctor" if medical else "solver", "content": "REQUEST TEST: chest X-ray" if medical else "Divide both sides by two."}],
            "output": "Pneumonia" if medical else r"\boxed{2}", "answer": "Pneumonia" if medical else "2"}


@pytest.mark.parametrize("kind", [MathRecords, MedicalRecords])
def test_upload_requires_process_not_only_raw_question(kind):
    report = kind().check([Row(1, {"id": "x", "question": "raw question"})])
    assert not report.ok
    value = record(kind is MedicalRecords)
    assert kind().check([Row(1, value)]).ok
    value["events"] = []
    assert not kind().check([Row(1, value)]).ok


def test_duplicate_and_answer_leak_are_rejected():
    value = record(True)
    assert not MedicalRecords().check([Row(1, value), Row(2, value)]).ok
    value["input"]["answer"] = "Pneumonia"
    assert not MedicalRecords().check([Row(1, value)]).ok


@pytest.mark.parametrize("algorithm,medical", [("fot-records", False), ("fot-records", True), ("evomedclaw-records", True)])
def test_record_to_library_to_application_without_agent(platform, client, algorithm, medical):
    task_type = "medical-records" if medical else "math-records"
    sites = []
    for source in ("a", "b"):
        value = record(medical)
        response = client.post('/v1/resources/data', data={'name': f'records-{source}', 'sourceName':source,
                              'hosting': 'platform', 'taskType':task_type},
                              files={'file': ('records.jsonl', json.dumps(value).encode(), 'application/jsonl')})
        assert response.status_code == 201, response.text
        data = response.json()
        sites.append({'participantId':data['source']['id'],'datasetId':data['dataset']['id']})
    response = client.post('/v1/tasks',json=config(sites,algorithm=algorithm,taskType=task_type,rounds=1,trialCap=1))
    assert response.status_code == 201, response.text
    id_ = response.json()['id']
    assert run(platform,id_) == 'completed', client.get(f'/v1/tasks/{id_}').json()
    result = client.get(f'/v1/tasks/{id_}').json()
    assert result['rounds'][0]['output']['items']
    assert not any(s['id'] in ('solve','diagnose','learn') for s in result['stages'])
    publish = client.post('/v1/apps',json={'taskId':id_,'builtAfterRound':1,'name':'shared experience'})
    assert publish.status_code == 201, publish.text
    app = publish.json()['id']
    body = {'input': record(True)['input'] if medical else 'Find x if 3x=9', 'model':'fake:fake'}
    applied = client.post(f'/v1/apps/{app}/invoke',json=body)
    assert applied.status_code == 200, applied.text
    assert applied.json()['output']


def test_local_generation_channel_uses_configured_model_and_admin_auth(platform, client):
    body = {'model': 'fake:fake', 'messages': [{'role':'user','content':'Solve 2x=4'}]}
    response = client.post('/v1/record-generation/chat', json=body)
    assert response.status_code == 200, response.text
    assert set(response.json()) == {'text', 'usage'}
    platform.settings.admin_token = 'test-only-token'
    assert client.post('/v1/record-generation/chat', json=body).status_code == 401
    assert client.post('/v1/record-generation/chat', json=body, headers={'Authorization':'Bearer test-only-token'}).status_code == 200


def test_medical_record_errors_keep_original_line_numbers():
    missing = record(True)
    missing.pop('answer')
    report = MedicalRecords().check([Row(8, missing)])
    assert not report.ok and report.count == 0 and report.issues[0].line == 8
    missing = record(True)
    missing['events'] = [{'role':'patient','content':'fever'}]
    assert not MedicalRecords().check([Row(2,missing)]).ok


def test_evo_retrieval_does_not_supply_irrelevant_cards():
    from fedagent_records.application import relevant_cards
    content = {'memory': {'entries':[{'entry_id':'e1','department':'general_internal_medicine',
        'owner_role':'local_doctor','stage':'synthesis','summary':'respiratory evidence',
        'guidance':'Assess respiratory causes', 'required_evidence':['cough','fever']}]}}
    assert not relevant_cards(content, {'patient':'knee injury', 'objective':'diagnose'})
    hits = relevant_cards(content, {'patient':'cough and fever', 'objective':'diagnose'})
    assert len(hits) == 1 and hits[0]['id'] == 'e1'
