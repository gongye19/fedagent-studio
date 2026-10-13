"""客户端租约、过期结果、重复提交和真实慢执行的回归检查。"""
from __future__ import annotations

import threading
import time
from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from fedagent_client.worker import ClientConfig, Worker
from test_api import config

from fedagent import models as m
from fedagent.platform import Platform


def prepare(client: TestClient, platform: Platform):
    participant = client.post('/v1/participants', data={
        'name': '本地测试方', 'hosting': 'local', 'datasetName': '本地题库',
        'scenario': 'horizontal', 'taskType': 'math-reasoning',
    }).json()
    pid = participant['id']
    dataset = client.get('/v1/datasets', params={'participant': pid}).json()[0]['id']
    token = client.post(f'/v1/participants/{pid}/client-tokens').json()['token']
    headers = {'Authorization': f'Bearer {token}'}
    hello = client.post('/v1/client/hello', headers=headers, json={
        'clientVersion': 'test', 'plugins': {'fot': '1.0.0'}, 'datasets': [{'datasetId': dataset, 'count': 2, 'answered': 1, 'itemIds': ['1', '2']}],
    })
    assert hello.status_code == 200
    task = client.post('/v1/tasks', json=config([
        {'participantId': 'p-a', 'datasetId': 'ds-aime24'}, {'participantId': pid, 'datasetId': dataset},
    ], trialCap=1)).json()['id']
    with platform.db.session() as session:
        session.get(m.Task, task).status = 'running'
        unit = m.WorkUnit(task_id=task, round=1, step='solve', site_id=pid, unit_key='1', executor='client')
        session.add(unit)
        session.flush()
        uid = unit.id
    return pid, dataset, token, task, uid, headers


def claim(client: TestClient, headers: dict):
    units = client.post('/v1/client/units/claim', headers=headers, json={'limit': 1}).json()
    assert len(units) == 1
    return {**headers, 'X-Fedagent-Attempt': str(units[0]['attempt'])}


def test_lease_owner_expiry_and_attempt(client: TestClient, platform: Platform):
    pid, _, _, _, uid, headers = prepare(client, platform)
    owned = claim(client, headers)
    other = client.post(f'/v1/participants/{pid}/client-tokens').json()['token']
    url = f'/v1/client/units/{uid}'
    assert client.get(url+'/inputs', headers={**owned, 'Authorization': f'Bearer {other}'}).status_code == 409
    with platform.db.session() as session:
        unit = session.get(m.WorkUnit, uid)
        unit.lease_until = m.now() - timedelta(seconds=1)
    assert client.post(url+'/complete', headers=owned, json={}).status_code == 409
    with platform.db.session() as session:
        unit = session.get(m.WorkUnit, uid)
        unit.status = 'pending'
        unit.claimed_by = None
    newer = claim(client, headers)
    for action, body in [('heartbeat', {}), ('complete', {}), ('fail', {'error': 'old'})]:
        assert client.post(url+'/'+action, headers=owned, json=body).status_code == 409
    assert client.post(url+'/complete', headers=newer, json={}).status_code == 204


def test_duplicate_completion_and_invalid_metrics(client: TestClient, platform: Platform):
    _, _, _, task, uid, headers = prepare(client, platform)
    owned = claim(client, headers)
    url = f'/v1/client/units/{uid}/complete'
    grade = {'itemId': '1', 'labeled': True, 'correct': True}
    assert client.post(url, headers=owned, json={'graded': [grade, grade]}).status_code == 422
    assert client.post(url, headers=owned, json={'reports': {'correct': 99}}).status_code == 422
    for _ in range(2):
        assert client.post(url, headers=owned, json={'graded': [grade]}).status_code == 204
    with platform.db.session() as session:
        assert session.query(m.Report).filter_by(task_id=task, name='correct').count() == 1
    assert client.post(f'/v1/client/units/{uid}/fail', headers=owned, json={'error': 'late'}).status_code == 409


def test_stopping_task_rejects_client_work(client: TestClient, platform: Platform):
    _, _, _, task, uid, headers = prepare(client, platform)
    owned = claim(client, headers)
    client.post(f'/v1/tasks/{task}/pause')
    assert client.get(f'/v1/client/units/{uid}/inputs', headers=owned).status_code == 409
    assert client.post('/v1/client/units/claim', headers=headers, json={'limit': 1}).json() == []


def test_slow_client_renews_lease_and_counts_zero_answer(client: TestClient, platform: Platform, tmp_path: Path):
    platform.settings.client_lease_seconds = 1
    _, dataset, token, _, uid, _ = prepare(client, platform)
    data = tmp_path/'local.jsonl'
    data.write_text('{"id":"1","question":"1-1?","answer":0}\n{"id":"2","question":"2-2?"}\n')
    worker = Worker(ClientConfig(server='http://testserver', token=token, datasets={dataset: data},
                                 state_path=tmp_path/'state.db', fake_model=True), transport=client._transport)
    worker.hello()
    original = worker.algorithms['fot']._steps['solve']
    heartbeat_started = threading.Event()
    original_request = worker._request

    def request(method, url, **kwargs):
        result = original_request(method, url, **kwargs)
        if url.endswith('/heartbeat'):
            heartbeat_started.set()
        return result

    def slow(ctx):
        assert heartbeat_started.wait(2)
        time.sleep(1.1)  # 超过初次领取的一秒租约。
        assert [item.id for item in ctx.items()] == ['1']
        original(ctx)

    worker._request = request
    worker.algorithms['fot']._steps['solve'] = slow
    assert worker.run_once() == 1
    with platform.db.session() as session:
        assert session.get(m.WorkUnit, uid).status == 'done'
        assert session.get(m.Dataset, dataset).answered == 1
    worker.http.close()


def test_trial_metric_uses_actual_local_labels(client: TestClient, platform: Platform):
    pid, _, _, task, uid, headers = prepare(client, platform)
    # 全库一半带标注，试跑只有一条；创建时估计为 0，第一轮判分后实际为 1。
    assert next(member for member in client.get(f'/v1/tasks/{task}').json()['members'] if member['participantId'] == pid)['answered'] == 0
    owned = claim(client, headers)
    grade = {'itemId': '1', 'labeled': True, 'correct': True}
    assert client.post(f'/v1/client/units/{uid}/complete', headers=owned, json={'graded': [grade]}).status_code == 204
    with platform.db.session() as session:
        session.add(m.WorkUnit(task_id=task, round=1, step='solve', site_id='p-a', unit_key='AIME24-000', executor='platform', status='done'))
    task_out = client.get(f'/v1/tasks/{task}').json()
    member = next(member for member in task_out['members'] if member['participantId'] == pid)
    assert member['answered'] == 1
    assert task_out['rounds'][0]['correct'][pid] == 1
