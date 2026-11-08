"""三组对照、病例边界、独立记忆与跨病例检索；全部使用本地测试数据。"""
import copy

import pytest
from fedagent_evomed import EvoMedClaw
from fedagent_evomed.memory import content_receipt, shared_content
from fedagent_evomed.vendor.federated.sanitize import build_federated_site_delta
from fedagent_evomed.vendor.learning.card_compiler import compile_card_bank
from fedagent_evomed.vendor.learning.skill_attribution import SkillAttributionReport
from fedagent_evomed.vendor.learning.types import CanonicalStep, CanonicalTrajectory
from fedagent_evomed.vendor.runtime.department_first.core.department_memory import DepartmentMemoryBank
from fedagent_evomed.vendor.runtime.department_first.core.types import MemoryEntry
from intake_helpers import verify_resources
from test_api import run
from test_medical import medical_agents, medical_config, medical_dataset

from fedagent import models as m
from fedagent.agents.protocol import AgentRequest, SavedValue
from fedagent.agents.runtime import context_of
from fedagent.agents.store import AgentStore


def prepare(client, remote):
    config = medical_config([{"participantId": p, "datasetId": medical_dataset(client, p)} for p in ("p-a", "p-b")])
    config.update(execution="agent", agentId=remote[0])
    medical_agents(client, config, remote[0])
    verify_resources(client, config)
    config["checkId"] = client.post("/v1/task-checks", json=config).json()["id"]
    return config


def test_three_groups_reuse_eval_cases_generate_once_and_paginate_by_case(platform, client, remote, monkeypatch):
    config = prepare(client, remote)
    wrong = client.post("/v1/tasks/validate", json={**config, "rounds": 2}).json()
    assert any(issue["field"] == "rounds" for issue in wrong["issues"])
    calls = []
    from fedagent_evomed.site import diagnose as original

    def observe(case, memory, *args, **kw):
        assert "answer" not in case
        calls.append((case["id"], copy.deepcopy(memory)))
        return original(case, memory, *args, **kw)

    monkeypatch.setattr("fedagent_evomed.site.diagnose", observe)
    made = client.post("/v1/tasks", json=config)
    assert made.status_code == 201, made.text
    task_id = made.json()["id"]
    assert run(platform, task_id) == "completed"
    task = client.get(f"/v1/tasks/{task_id}").json()
    assert task["evaluationLabels"] == ["无经验", "本地经验", "联邦经验"]
    assert all(member["sampleCounts"] == {"经验生成": 1, "独立评测": 1} for member in task["members"])
    evaluation = [memory for item, memory in calls if item == "eval-private"]
    assert len(evaluation) == 6 and evaluation[:2] == [None, None]
    assert all(memory is not None for memory in evaluation[2:])
    assert [memory for item, memory in calls if item == "learn-private"] == [None, None]
    formal = [req for req in remote[1] if req.task_id == task_id]
    assert {req.round for req in formal if req.step == "learn"} == {2}
    assert all(req.artifact is None for req in formal if req.round < 3)
    page = client.get(f"/v1/tasks/{task_id}/case-comparisons?limit=1").json()
    assert page["total"] == 2 and page["hasMore"]
    assert [case["round"] for case in page["items"][0]["cases"]] == [1, 2, 3]
    assert page["items"][0]["itemId"].startswith("样本 ")
    assert all(case["itemId"] == page["items"][0]["itemId"] for case in page["items"][0]["cases"])
    second = client.get(f"/v1/tasks/{task_id}/case-comparisons?offset=1&limit=1").json()
    assert not second["hasMore"] and second["items"][0]["key"] != page["items"][0]["key"]
    store = AgentStore(platform.settings.data_dir / "remote")
    with store.connect() as db:
        assert db.execute("SELECT count(*) FROM private_state WHERE task LIKE 'check-%'").fetchone()[0] == 0
    # 新插件不能把旧任务解释为三组对照。
    with platform.db.session() as db:
        old = db.get(m.Task, task_id)
        algorithm = platform.registry.algorithm("evomedclaw")
        old.audit = {**old.audit, "manifest": algorithm.manifest_for_version("1.2.0").model_dump(mode="json", by_alias=True)}
    assert client.get(f"/v1/tasks/{task_id}").json()["evaluationLabels"] == []


def delta(site, case, evidence, action):
    trajectory = CanonicalTrajectory(case, "private", steps=[CanonicalStep(case, "evidence_build", "local_doctor",
        positives=[evidence], action_type="request_test", action_payload=action)], final_outcome={"answer": "example", "is_correct": True})
    bank = compile_card_bank([trajectory])
    return build_federated_site_delta(site_id=site, card_bank=bank, attribution_report=SkillAttributionReport()).to_dict()


def test_real_compiler_and_retrieval_transfer_to_matching_evidence_without_case_identity():
    a = delta("a", 100, "alpha evidence", "test alpha")
    b = delta("b", 200, "beta finding", "test beta")
    local = shared_content([b])["memory"]
    shared = shared_content([a, b])["memory"]
    assert len(local["entries"]) == 1 and len(shared["entries"]) == 2
    assert "source_cases" not in str(shared_content([a, b])["cards"])
    def retrieve(memory, text):
        bank = DepartmentMemoryBank([MemoryEntry(**entry) for entry in memory["entries"]])
        return bank.retrieve("general_internal_medicine", "local_doctor", "evidence_build", text)
    # 这里的 alpha/beta 只是测试标记；不模拟医疗准确率。实际检索不接收病例ID。
    assert not retrieve(local, "new patient alpha evidence")
    hits = retrieve(shared, "new patient alpha evidence")
    assert len(hits) == 1 and "test alpha" in hits[0].guidance
    assert not retrieve(shared, "unrelated words")
    assert not DepartmentMemoryBank([MemoryEntry(**e) for e in shared["entries"]]).retrieve(
        "general_internal_medicine", "specialist", "department_consult", "alpha evidence")


def test_local_receipt_rejects_wrong_content_foreign_hits_and_wrong_scope():
    from fedagent_evomed.contracts import validate_experience
    algorithm = EvoMedClaw()
    memory = shared_content([delta("a", 100, "alpha evidence", "test alpha")])["memory"]
    proof = content_receipt(memory)
    request = AgentRequest(run_id="test", algorithm=algorithm.id, version=algorithm.version, task_type="medical-diagnosis",
        task_id="t", site_id="a", role="participant", round=2, rounds=3, step="load_local_memory", unit_key="_",
        state=[SavedValue(round=2, key="local_memory_receipt", value=proof)])
    ctx = context_of(request, algorithm)
    valid = {"scope": "local", "version": None, "sha256": proof["sha256"], "retrieved": proof["entries"]}
    validate_experience(ctx, valid)
    for invalid in ({**valid, "scope": "federated"}, {**valid, "sha256": "0" * 64}, {**valid, "retrieved": ["foreign"]}):
        with pytest.raises(ValueError):
            validate_experience(ctx, invalid)
