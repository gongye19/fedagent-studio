"""平台模型只读与服务器本地维护，独立于用户自有接口。"""
import pytest

from fedagent import cli
from fedagent import models as m
from fedagent.resource_services.verification import endpoint_signature


@pytest.mark.parametrize('id_', ['default', 'platform-custom-id'])
def test_platform_model_http_mutations_are_rejected(platform, client, id_):
    with platform.db.session() as session:
        if id_ != 'default':
            session.add(m.Endpoint(id=id_, name='平台模型', kind='openai', builtin=True, resource_space='workspace'))
        row = session.get(m.Endpoint, id_)
        row.name = '平台模型'
        row.base_url = 'https://example.com/v1'
        row.models = ['platform-model']
        row.shared = True
        row.api_key_enc = platform.secrets.encrypt('test-only-key')
        row.verification_hash = endpoint_signature(row)
    original = client.get('/v1/endpoints').json()
    body = {'name': '改名', 'baseUrl': 'https://example.com/v1', 'models': ['changed'], 'apiKey': 'changed'}
    assert client.put(f'/v1/endpoints/{id_}', json=body).status_code == 403
    assert client.delete(f'/v1/endpoints/{id_}').status_code == 409
    for shared in (False, True):
        assert client.patch(f'/v1/resources/llm/{id_}/sharing', json={'shared': shared}).status_code == 403
    assert client.get('/v1/endpoints').json() == original


def test_default_id_protected_even_without_builtin_flag(platform, client):
    with platform.db.session() as session:
        row = session.get(m.Endpoint, 'default')
        row.builtin = False
        row.resource_space = 'workspace'
    assert client.put('/v1/endpoints/default', json={'name':'changed', 'models':['model']}).status_code == 403
    assert client.delete('/v1/endpoints/default').status_code == 409
    assert client.patch('/v1/resources/llm/default/sharing', json={'shared':False}).status_code == 403


def test_personal_model_lifecycle_remains_available(platform, client, monkeypatch):
    body = {'name':'自己的模型', 'baseUrl':'https://example.com/v1', 'models':['model'], 'apiKey':'test-only-key'}
    response = client.post('/v1/endpoints', json=body)
    assert response.status_code == 201
    id_ = response.json()['id']
    monkeypatch.setattr(type(platform.gateway), 'list_models', lambda *args: ['model'])
    monkeypatch.setattr(type(platform.gateway), 'probe', lambda *args: None)
    assert client.post(f'/v1/endpoints/{id_}/test').json()['ok']
    updated = client.put(f'/v1/endpoints/{id_}', json={**body, 'name':'更新名称', 'apiKey': None})
    assert updated.status_code == 200 and updated.json()['verified'] and updated.json()['hasKey']
    assert client.delete(f'/v1/endpoints/{id_}').status_code == 204


def test_operator_configures_default_locally_without_losing_limits_or_key(platform, monkeypatch, capsys):
    monkeypatch.setattr(cli, '_platform', lambda: platform)
    monkeypatch.setattr(type(platform.gateway), 'list_models', lambda *args: ['model', 'new-model'])
    monkeypatch.setattr(type(platform.gateway), 'probe', lambda *args: None)
    monkeypatch.setattr('getpass.getpass', lambda prompt: '')
    with platform.db.session() as session:
        row = session.get(m.Endpoint, 'default')
        row.base_url = 'https://example.com/v1'
        row.models = ['model']
        row.concurrency, row.price, row.timeout, row.max_retries = 3, 12, 123, 2
        row.api_key_enc = platform.secrets.encrypt('test-only-key')
        row.verification_hash = endpoint_signature(row)
        encrypted = row.api_key_enc
    cli.main(['models', 'configure-default', '--name', '平台模型', '--base-url', 'https://example.com/v1', '--model', 'model'])
    with platform.db.session() as session:
        row = session.get(m.Endpoint, 'default')
        assert row.name == '平台模型' and row.api_key_enc == encrypted
        assert (row.concurrency, row.price, row.timeout, row.max_retries) == (3, 12, 123, 2)
        assert row.verification_hash == endpoint_signature(row)
    assert 'test-only-key' not in capsys.readouterr().out
    cli.main(['models', 'configure-default', '--base-url', 'https://example.org/v1', '--model', 'new-model'])
    with platform.db.session() as session:
        row = session.get(m.Endpoint, 'default')
        assert row.api_key_enc is None
        assert row.verification_hash == endpoint_signature(row)


def test_http_probes_neither_invalidate_nor_certify_platform_default(platform, client, monkeypatch):
    from fedagent_sdk import ModelError

    with platform.db.session() as session:
        row = session.get(m.Endpoint, 'default')
        row.base_url = 'https://example.com/v1'
        row.models = ['model']
        proof = row.verification_hash = endpoint_signature(row)
    monkeypatch.setattr(type(platform.gateway), 'list_models', lambda *args: ['model'])
    def unavailable(*args):
        raise ModelError('临时不可达')
    monkeypatch.setattr(type(platform.gateway), 'probe', unavailable)
    assert client.post('/v1/endpoints/default/test').json()['ok'] is False
    with platform.db.session() as session:
        row = session.get(m.Endpoint, 'default')
        assert row.verification_hash == proof
        row.verification_hash = None
    monkeypatch.setattr(type(platform.gateway), 'probe', lambda *args: None)
    assert client.post('/v1/endpoints/default/test').json()['ok'] is True
    with platform.db.session() as session:
        assert session.get(m.Endpoint, 'default').verification_hash is None


def test_operator_failed_verification_keeps_model_unavailable(platform, monkeypatch):
    from fedagent_sdk import ModelError

    from fedagent.resource_services.verification import endpoint_verified

    monkeypatch.setattr(cli, '_platform', lambda: platform)
    monkeypatch.setattr('getpass.getpass', lambda prompt: 'test-only-new-key')
    monkeypatch.setattr(type(platform.gateway), 'list_models', lambda *args: ['model'])
    def unavailable(*args):
        raise ModelError('验证失败')
    monkeypatch.setattr(type(platform.gateway), 'probe', unavailable)
    with pytest.raises(SystemExit, match='1'):
        cli.main(['models', 'configure-default', '--base-url', 'https://example.com/v1', '--model', 'model'])
    with platform.db.session() as session:
        assert not endpoint_verified(session.get(m.Endpoint, 'default'))
