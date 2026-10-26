"""测试先走资源接入，再验证任务轻量连通性；不跳过业务输出校验。"""
def verify_one(client, config, participant=None):
    participant = participant or config['participants'][0]
    agent_id = config.get('agentOverrides', {}).get(participant['participantId']) or config['agentId']
    response = client.post('/v1/agents/'+agent_id+'/verifications', json={
        'algorithm': config['algorithm'], 'taskType': config['taskType'], 'datasetId': participant['datasetId'], 'params': config.get('params', {})})
    assert response.status_code == 202, response.text
    return client.get('/v1/task-checks/'+response.json()['id']).json()


def verify_resources(client, config):
    if config.get('execution') != 'agent':
        return
    agents = {a['id']: a for a in client.get('/v1/agents').json()}
    seen = set()
    for participant in config['participants']:
        agent_id = config.get('agentOverrides', {}).get(participant['participantId']) or config['agentId']
        if agent_id in seen:
            continue
        seen.add(agent_id)
        if any(v['current'] and v['algorithm'] == config['algorithm'] and v['taskType'] == config['taskType'] for v in agents[agent_id]['verifications']):
            continue
        report = verify_one(client, config, participant)
        assert report['status'] == 'passed', report
