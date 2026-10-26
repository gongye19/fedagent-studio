"""接入验证凭据：仅证明指定版本的接口合同，不替代任务的实时连通性。"""
import hashlib
import json

from .. import models as m


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def endpoint_signature(row: m.Endpoint) -> str:
    return digest([row.kind, row.base_url, row.models, row.api_key_enc])


def endpoint_verified(row: m.Endpoint) -> bool:
    return row.kind == "fake" or row.verification_hash == endpoint_signature(row)


def agent_signature(platform, row, algorithm, task_type) -> str:
    return digest(["agent-intake", row.id, row.revision, algorithm.code_hash(), task_type,
                   platform.registry.task_type(task_type).schema_version])


def agent_verified(platform, session, row, algorithm, task_type) -> bool:
    proof = (row.verifications or {}).get(f"{algorithm.id}:{task_type}", {})
    report = session.get(m.TaskCheck, proof.get("check_id")) if proof.get("check_id") else None
    capability = (row.capabilities or {}).get("algorithms", {}).get(algorithm.id, {})
    steps = {step.id for step in algorithm.manifest.steps if step.at != "server"}
    compatible = capability.get("version") == algorithm.version and steps <= set(capability.get("steps", []))
    return bool(compatible and report and report.status == "passed" and report.fingerprint == agent_signature(platform, row, algorithm, task_type))
