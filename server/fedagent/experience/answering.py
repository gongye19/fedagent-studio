"""评测作答与评分分别缓存，业务校验失败只作废本病例相应调用。"""
from fedagent_sdk import ApplyRequest, Artifact, ModelError
from sqlalchemy import update

from .. import models as m
from ..gateway import EndpointConfig, LedgerKey
from ..model_runtime import GatewayModel
from ..platform import Platform
from ..schemas.experience import Arm, EvaluationArm
from .consultation import MEDICAL_RECORDS, experience_guidance


def discard(platform: Platform, key: LedgerKey) -> None:
    with platform.db.session() as session:
        session.execute(update(m.CallRecord).where(
            m.CallRecord.task_id == key.task_id, m.CallRecord.site_id == key.site_id,
            m.CallRecord.round == key.round, m.CallRecord.step == key.step,
            m.CallRecord.unit_key == key.unit_key, m.CallRecord.status == "ok",
        ).values(status="discarded"))


def evaluate_arm(platform: Platform, job: m.Task, case: dict, index: int, arm: Arm, artifact: Artifact | None,
                 resolved: tuple[EndpointConfig, str] | None = None) -> EvaluationArm:
    algorithm = platform.registry.algorithm(job.algorithm)
    grader = platform.registry.grader(job.config.get("grader") or platform.registry.task_type(MEDICAL_RECORDS).graders[0])
    resolved = resolved or platform.gateway.resolve(job.config["model"])
    key = LedgerKey(job.id, case["site_id"], 1, arm, str(index))
    model = GatewayModel(platform.gateway, *resolved, plugin=algorithm, purpose="experience-eval", ledger=key, step_id=None)
    try:
        response = algorithm.apply(artifact, ApplyRequest(input=case["input"]), model)
        if not response.output.strip():
            raise ModelError("模型未返回诊断")
    except ModelError:
        discard(platform, key)
        raise
    grading_key = LedgerKey(job.id, case["site_id"], 1, f"{arm}-grade", str(index))
    grading_model = GatewayModel(platform.gateway, *resolved, plugin=algorithm, purpose="experience-eval", ledger=grading_key, step_id=None)
    try:
        correct = grader.evaluate(response.details.get("diagnosis", response.output), {"answer": case["reference"]}, grading_model)
    except ModelError:
        discard(platform, grading_key)
        raise
    keys = []
    if artifact is not None:
        guidance = experience_guidance(job.algorithm, artifact.content, case["input"])
        keys = list(guidance) if isinstance(guidance, dict) else [entry["id"] for entry in guidance]
    return EvaluationArm(output=response.output, correct=correct, experience_keys=keys)
