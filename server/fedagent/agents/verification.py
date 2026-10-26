"""Agent 接入时用用户明确选定的数据验证完整输出合同；不启动联邦任务。"""
from fedagent_sdk import ModelError, StepFailed
from sqlalchemy import update

from .. import models as m
from ..checks.progress import Progress
from ..data import check_file
from ..errors import ServiceError
from ..resource_services.verification import agent_signature
from ..resources import new_id
from ..schemas import TaskConfigIn
from ..schemas.checks import CheckResult
from ..task_services.preparation import PreparedSite
from .contract_check import check_agent
from .gateway import AgentError, AgentGateway
from .resources import compatible, get


def prepare(platform, session, agent_id, body):
    agent = get(session, agent_id)
    algorithm = platform.registry.algorithms.get(body.algorithm)
    if algorithm is None or body.task_type not in algorithm.manifest.accepts or not algorithm.manifest.agent_supported:
        raise ServiceError(422, "请选择 Agent 支持的算法和任务类型")
    dataset = session.get(m.Dataset, body.dataset_id)
    if (dataset is None or dataset.task_type != body.task_type or not dataset.content_path
            or (dataset.resource_space != "workspace" and not dataset.shared)):
        raise ServiceError(422, "请选择可用的兼容数据用于接入验证")
    participant = session.get(m.Participant, dataset.participant_id)
    task_type = platform.registry.task_type(body.task_type)
    rows = platform.files.load(dataset.content_path)
    report = check_file(task_type, (platform.settings.datasets_dir / dataset.content_path).read_bytes())
    if not report.ok or len(rows) < algorithm.min_samples_per_site:
        raise ServiceError(422, "验证数据不符合任务规范或样本不足，请重新上传")
    problems = algorithm.manifest.check_params(body.params)
    if problems:
        raise ServiceError(422, "；".join(problems))
    site = PreparedSite(participant, dataset, [task_type.item_id(row) for row in rows], dataset.answered, "", agent_id)
    config = TaskConfigIn(scenario=algorithm.manifest.scenario, algorithm=algorithm.id, task_type=body.task_type,
                          participants=[], rounds=algorithm.manifest.rounds.default, execution="agent", params=body.params)
    return agent, algorithm, task_type, site, rows, config


def create(platform, session, agent_id, body):
    agent, algorithm, *_ = prepare(platform, session, agent_id, body)
    try:
        cap = AgentGateway(platform).capabilities(agent_id)
    except AgentError as error:
        raise ServiceError(502, str(error)) from error
    if not compatible(cap, algorithm):
        raise ServiceError(422, "接口未声明支持所选算法的完整步骤")
    key = f"{algorithm.id}:{body.task_type}"
    previous = (agent.verifications or {}).get(key, {})
    pending = session.get(m.TaskCheck, previous.get("check_id")) if previous.get("check_id") else None
    if pending and pending.status in ("queued", "running"):
        raise ServiceError(409, "该接口正在验证，请查看当前进度")
    report = m.TaskCheck(id=new_id("check"), fingerprint=agent_signature(platform, agent, algorithm, body.task_type))
    session.add(report)
    previous_proofs = agent.verifications or {}
    proofs = {**previous_proofs, key: {
        "algorithm": algorithm.id, "task_type": body.task_type, "dataset_id": body.dataset_id, "check_id": report.id,
    }}
    changed = session.execute(update(m.AgentEndpoint).where(
        m.AgentEndpoint.id == agent_id, m.AgentEndpoint.revision == agent.revision,
        m.AgentEndpoint.verifications == previous_proofs,
    ).values(verifications=proofs, capabilities=cap.model_dump(mode="json")).execution_options(synchronize_session=False))
    if changed.rowcount != 1:
        raise ServiceError(409, "接口已变化或正在验证，请刷新后重试")
    session.flush()
    return report


def run(platform, check_id, agent_id, body):
    progress = Progress(platform, check_id)
    positions = {}

    def notify(key, label, status):
        positions[key] = progress.put(CheckResult(field="agent", resource=label, status=status, message=""), positions.get(key))

    try:
        with platform.db.session() as session:
            session.get(m.TaskCheck, check_id).status = "running"
            agent, algorithm, task_type, site, rows, config = prepare(platform, session, agent_id, body)
            if session.get(m.TaskCheck, check_id).fingerprint != agent_signature(platform, agent, algorithm, body.task_type):
                raise ValueError("接口已修改，请重新验证")
        check_agent(platform, agent_id, algorithm, task_type, site, rows, check_id, config, on_step=notify)
        with platform.db.session() as session:
            agent = get(session, agent_id)
            if session.get(m.TaskCheck, check_id).fingerprint != agent_signature(platform, agent, algorithm, body.task_type):
                raise ValueError("验证期间接口已修改，请重新验证")
    except Exception as error:
        message = str(error)[:500] if isinstance(error, (ValueError, ModelError, StepFailed, ServiceError)) else "验证中断，请检查接口后重试"
        active = next((index for index, result in enumerate(progress.results) if result.status == "running"), None)
        label = progress.results[active].resource if active is not None else "接入验证"
        progress.put(CheckResult(field="agent", resource=label, status="failed", message=message), active)
    finally:
        for index, result in enumerate(list(progress.results)):
            if result.status == "running":
                progress.put(result.model_copy(update={"status": "failed", "message": "验证中断，请重试"}), index)
        if AgentGateway(platform).stop_check(check_id):
            progress.put(CheckResult(field="agent", resource="停止确认", status="failed", message="Agent 尚未确认停止，请在接口页恢复连接后重试"))
        with platform.db.session() as session:
            row = session.get(m.TaskCheck, check_id)
            row.results = [result.model_dump() for result in progress.results]
            row.status = "passed" if row.results and all(result.status == "passed" for result in progress.results) else "failed"
            row.finished_at = m.now()
