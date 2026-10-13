"""任务内接入、资源分区和正式任务的自有输入要求。"""
import importlib

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from test_api import config


def upload(client, **fields):
    data = {'name': '自有题库', 'taskType': 'math-reasoning', 'hosting': 'platform', **fields}
    return client.post('/v1/resources/data', data=data, files={'file': ('math.jsonl', b'{"id":"1","question":"1+1","answer":"2"}\n')})


def test_resource_intake_and_reuse(client):
    before = client.get('/v1/participants').json()
    bad = client.post('/v1/resources/data', data={'name': '坏文件', 'taskType': 'math-reasoning', 'hosting': 'platform'},
                      files={'file': ('bad.jsonl', b'{}\n')})
    assert bad.status_code == 422 and client.get('/v1/participants').json() == before
    response = upload(client)
    assert response.status_code == 201, response.text
    first = response.json()
    assert first['dataset']['resourceSpace'] == 'workspace'
    assert first['source']['name'] == '自有题库'
    second = upload(client, sourceId=first['source']['id'], name='同来源第二份')
    assert second.status_code == 201 and second.json()['source']['id'] == first['source']['id']
    assert upload(client, sourceId='p-a').status_code == 409
    assert client.delete('/v1/resources/data/ds-aime24').status_code == 409
    assert client.delete('/v1/resources/data/'+first['dataset']['id']).status_code == 204
    assert client.delete('/v1/resources/data/'+second.json()['dataset']['id']).status_code == 204
    assert client.get('/v1/participants').json() == before


def test_local_resource_keeps_execution_connection(client):
    response = client.post('/v1/resources/data', data={'name': '本地数据', 'taskType': 'math-reasoning', 'hosting': 'local'})
    assert response.status_code == 201
    resource = response.json()
    assert resource['dataset']['resourceSpace'] == 'workspace' and not resource['dataset']['ready']
    assert resource['source']['status'] == 'waiting'
    assert client.delete('/v1/resources/data/'+resource['dataset']['id']).status_code == 204
    assert any(p['id'] == resource['source']['id'] for p in client.get('/v1/participants').json())


def test_formal_requires_own_data_and_active_resource_cannot_delete(client):
    public = [{'participantId': 'p-a', 'datasetId': 'ds-aime24'}, {'participantId': 'p-b', 'datasetId': 'ds-aime25'}]
    body = config(public, mode='full')
    report = client.post('/v1/tasks/validate', json=body).json()
    assert any('至少需要一份我的数据' in issue['message'] for issue in report['issues'])
    assert not client.post('/v1/tasks/validate', json=config(public)).json()['issues']
    own = upload(client).json()
    mixed = [{'participantId': own['source']['id'], 'datasetId': own['dataset']['id']}, public[0]]
    assert not client.post('/v1/tasks/validate', json=config(mixed, mode='full')).json()['issues']
    created = client.post('/v1/tasks', json=config(mixed))
    assert created.status_code == 201
    assert client.delete('/v1/resources/data/'+own['dataset']['id']).status_code == 409


def test_requirements_are_from_actual_algorithm_steps(client):
    algorithms = {a['id']: a for a in client.get('/v1/registry').json()['algorithms']}
    assert algorithms['fot']['requirements']['serverModel']
    assert not algorithms['evomedclaw']['requirements']['serverModel']
    assert algorithms['evomedclaw']['requirements']['minSamples'] == 2
    assert all(d['resourceSpace'] == 'public' for d in client.get('/v1/datasets').json())
    endpoint = client.post('/v1/endpoints', json={'name': '我的模型', 'baseUrl': 'https://unused.invalid/v1', 'models': ['private-model']}).json()
    assert endpoint['resourceSpace'] == 'workspace'


def test_migration_does_not_make_unrelated_uploads_public():
    engine = create_engine('sqlite://')
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE datasets (id TEXT, source TEXT, source_hash TEXT)'))
        conn.execute(text('CREATE TABLE endpoints (id TEXT, builtin INTEGER)'))
        known = '53cf0d249a44c14c1487c26b8c26c766632e390eb39d7f61dc3167b8f0fe208e'
        conn.execute(text('INSERT INTO datasets VALUES (:id,:source,:hash)'), [
            {'id': 'baseline', 'source': 'builtin', 'hash': None},
            {'id': 'ds-7cda527c', 'source': 'upload', 'hash': known},
            {'id': 'my-medical', 'source': 'upload', 'hash': known},
            {'id': 'ds-73dafbc1', 'source': 'upload', 'hash': 'different-file'},
        ])
        conn.execute(text("INSERT INTO endpoints VALUES ('default',1),('private',0)"))
        with Operations.context(MigrationContext.configure(conn)):
            importlib.import_module('fedagent.migrations.versions.0004_resource_spaces').upgrade()
        spaces = dict(conn.execute(text('SELECT id,resource_space FROM datasets')).all())
        assert spaces == {'baseline': 'public', 'ds-7cda527c': 'public', 'my-medical': 'workspace', 'ds-73dafbc1': 'workspace'}
        assert dict(conn.execute(text('SELECT id,resource_space FROM endpoints')).all()) == {'default': 'public', 'private': 'workspace'}
