"""结果案例必须来自已提交判分，不影响指标，也不泄露隐藏推理。"""
from sqlalchemy import select
from test_agents import fot_config
from test_api import run

from fedagent import models as m
from fedagent.task_services.cases import display_text, snapshot


def test_cases_persist_predictions_filter_and_do_not_change_scores(platform, client):
    config = fot_config(client)
    task = client.post('/v1/tasks', json=config).json()
    run(platform, task['id'])
    url = f'/v1/tasks/{task["id"]}/cases'
    page = client.get(url).json()
    assert page['total'] == 4 and sum(page['counts'].values()) == 4
    assert all((c['input'] or c['fields']) and c['prediction'] and c['reference'] for c in page['items'])
    for outcome, count in page['counts'].items():
        filtered = client.get(url, params={'outcome': outcome}).json()
        assert filtered['total'] == count and all(c['outcome'] == outcome for c in filtered['items'])
    first = client.get(url, params={'limit': 1}).json()
    second = client.get(url, params={'limit': 1, 'offset': 1}).json()
    assert first['hasMore'] and first['items'][0]['key'] != second['items'][0]['key']
    assert client.get(url, params={'round': 1}).json()['total'] == 2
    assert client.get(url, params={'round': 1, 'site': page['items'][0]['site']}).json()['total'] == 1
    result = client.get(f'/v1/tasks/{task["id"]}').json()
    for record in result['rounds']:
        for site, correct in (record.get('correct') or {}).items():
            assert sum(c['outcome'] == 'passed' for c in page['items'] if c['site'] == site and c['round'] == record['round']) == correct
    assert client.get('/v1/tasks/missing/cases').status_code == 404
    assert client.get(url, params={'offset': -1}).status_code == 422


def test_historical_grades_remain_readable_without_fabricated_answers(platform, client):
    task = client.post('/v1/tasks', json=fot_config(client)).json()
    run(platform, task['id'])
    with platform.db.session() as session:
        rows = session.scalars(select(m.Report).where(m.Report.task_id == task['id'], m.Report.name == 'case_result')).all()
        for row in rows:
            session.delete(row)
    page = client.get(f'/v1/tasks/{task["id"]}/cases').json()
    assert page['total'] == 4
    assert all(c['prediction'] is None and c['reference'] is None for c in page['items'])
    with platform.db.session() as session:
        unit = session.scalars(select(m.WorkUnit).where(m.WorkUnit.task_id == task['id'], m.WorkUnit.step == 'solve')).first()
        unit.status, unit.error = 'failed', '判分失败：连接超时'
        for row in session.scalars(select(m.Report).where(m.Report.task_id == task['id'], m.Report.round == unit.round,
                                                        m.Report.site_id == unit.site_id, m.Report.unit_key == unit.unit_key)):
            session.delete(row)
    with platform.db.session() as session:
        unit = session.scalars(select(m.WorkUnit).where(m.WorkUnit.task_id == task['id'], m.WorkUnit.step == 'reflect')).first()
        unit.status, unit.error = 'failed', '模型调用失败'
    failed = client.get(f'/v1/tasks/{task["id"]}/cases?outcome=error').json()
    assert failed['total'] == 2 and all(c['outcome'] == 'error' for c in failed['items'])
    assert {c['step'] for c in failed['items']} == {'solve', 'reflect'}
    assert {c['error'] for c in failed['items']} == {'判分失败：连接超时', '模型调用失败'}


def test_snapshot_nested_labels_and_thinking_are_not_displayed():
    class Type:
        label_fields = ('target.answer',)
        def strip_labels(self, record):
            return {'question': record['question']}
        def input_of(self, record):
            assert 'target' not in record
            return record['question']
    result = snapshot(Type(), {'question': 'Q', 'target': {'answer': 'A'}}, 'one', '<think>private</think>A', True, True)
    assert result['input'] == 'Q' and result['reference'] == 'A' and result['prediction'] == 'A'
    assert display_text('answer<analysis>private') == 'answer'
    assert snapshot(Type(), {'question': 'Q'}, 'one', 'A', False, False)['outcome'] == 'unlabeled'
