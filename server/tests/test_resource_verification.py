"""接入做完整验证，任务开始只做连通性，接口变更不可沿用旧凭据。"""
import httpx
from intake_helpers import verify_resources
from test_agents import fot_config
from test_medical import medical_agents, medical_config, medical_dataset

from fedagent.agents.gateway import AgentGateway


def test_task_connection_does_not_execute_agents_or_models(client, platform, remote, monkeypatch):
    config = medical_config([{'participantId': p, 'datasetId': medical_dataset(client, p)} for p in ('p-a', 'p-b')])
    config.update(execution='agent', agentId=remote[0])
    medical_agents(client, config, remote[0])
    assert client.post('/v1/task-checks', json=config).status_code == 422
    verify_resources(client, config)
    calls = len(remote[1])
    def forbidden(*args, **kwargs):
        raise AssertionError('任务连接检查不能执行模型或Agent工作流')
    monkeypatch.setattr(AgentGateway, 'execute', forbidden)
    monkeypatch.setattr(platform.gateway, 'probe', forbidden)
    response = client.post('/v1/task-checks', json=config)
    assert response.status_code == 202
    result = client.get('/v1/task-checks/'+response.json()['id']).json()
    assert result['status'] == 'passed', result
    assert len(remote[1]) == calls
    assert all(row['status'] == 'passed' for row in result['results'])


def test_agent_name_preserves_proof_but_address_change_invalidates(client, remote):
    config = fot_config(client)
    config.update(execution='agent', agentId=remote[0])
    verify_resources(client, config)
    name_only = client.put('/v1/agents/'+remote[0], json={'name': '新名称', 'baseUrl': 'https://agent.test'}).json()
    assert name_only['revision'] == 1 and name_only['verifications'][0]['current']
    changed = client.put('/v1/agents/'+remote[0], json={'name': '新地址', 'baseUrl': 'https://new.test'}).json()
    assert changed['revision'] == 2 and not changed['verifications'][0]['current']
    assert client.post('/v1/task-checks', json=config).status_code == 422


def test_llm_intake_proof_and_no_generation_during_task_connection(platform, client):
    made = client.post('/v1/endpoints', json={'name':'自有LLM', 'baseUrl':'https://llm.test/v1', 'models':['m'], 'apiKey':'test-only-key'}).json()
    config = {**fot_config(client), 'clientModel': made['id']+':m', 'serverModel':made['id']+':m'}
    assert not made['verified']
    assert client.post('/v1/task-checks', json=config).status_code == 422
    requests = []
    def answer(req):
        requests.append((req.method,req.url.path))
        return httpx.Response(200, json={'data':[{'id':'m'}]} if req.url.path.endswith('/models') else
                              {'model':'m','choices':[{'message':{'content':'OK'},'finish_reason':'stop'}],'usage':{}})
    platform.gateway._transport = httpx.MockTransport(answer)
    assert client.post('/v1/endpoints/'+made['id']+'/test').json()['ok']
    before = len(requests)
    response = client.post('/v1/task-checks', json=config)
    assert client.get('/v1/task-checks/'+response.json()['id']).json()['status'] == 'passed'
    assert requests[before:] == [('GET','/v1/models')]
    changed = client.put('/v1/endpoints/'+made['id'], json={'name':'改地址', 'baseUrl':'https://different.test/v1', 'models':['m']}).json()
    assert not changed['hasKey'] and not changed['verified']
    assert client.post('/v1/task-checks', json=config).status_code == 422


def test_concurrent_intake_requests_start_only_one_paid_verification(client, remote, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Lock
    gate, lock = Barrier(2), Lock()
    original = AgentGateway.request
    reached = 0
    def synchronize(self, agent_id, method, path, body=None):
        nonlocal reached
        if path == '/capabilities':
            with lock:
                reached += 1
                wait = reached <= 2
            if wait:
                gate.wait(timeout=5)
        return original(self, agent_id, method, path, body)
    monkeypatch.setattr(AgentGateway, 'request', synchronize)
    config = fot_config(client)
    body = {'algorithm':'fot', 'taskType':'math-reasoning', 'datasetId':config['participants'][0]['datasetId']}
    def submit():
        return client.post('/v1/agents/'+remote[0]+'/verifications', json=body)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = [pool.submit(submit) for _ in range(2)]
        statuses = sorted(f.result().status_code for f in responses)
    assert statuses == [202, 409]
    assert len({r.task_id for r in remote[1]}) == 1
