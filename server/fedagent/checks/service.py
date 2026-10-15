from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from typing import Literal

from fedagent_sdk import ModelError, StepFailed
from sqlalchemy import update

from .. import models as m
from ..agents.adapter import validate_result
from ..agents.gateway import AgentGateway
from ..agents.protocol import AgentRequest
from ..agents.resources import compatible
from ..agents.runtime import context_of
from ..data import check_file, to_item
from ..errors import ServiceError
from ..resources import new_id, not_found
from ..schemas import TaskConfigIn
from ..schemas.checks import CheckResult, TaskCheckOut
from ..task_services.preparation import validate
from .fingerprint import fingerprint

EXPIRY = timedelta(minutes=15)


def out(row: m.TaskCheck) -> TaskCheckOut:
    return TaskCheckOut.model_validate(
        {"id": row.id, "status": row.status, "results": row.results, "created_at": row.created_at, "finished_at": row.finished_at}
    )


def get(session, check_id: str) -> m.TaskCheck:
    row = session.get(m.TaskCheck, check_id)
    if row is None:
        raise not_found("配置测试")
    return row


def create(platform, session, body: TaskConfigIn) -> m.TaskCheck:
    issues, _ = validate(platform, session, body)
    if issues:
        raise ServiceError(422, {"issues": [issue.model_dump() for issue in issues]})
    row = m.TaskCheck(id=new_id("check"), fingerprint=fingerprint(platform, session, body))
    session.add(row)
    session.flush()
    return row


def require_check(platform, session, body: TaskConfigIn) -> None:
    # 兼容已有内置工作流 API；新界面与外部 Agent 必须先主动测试。
    if body.check_id is None and body.execution == "builtin":
        return
    row = session.get(m.TaskCheck, body.check_id) if body.check_id else None
    if row is None or row.status != "passed" or m.now() - m.aware(row.created_at) > EXPIRY or row.fingerprint != fingerprint(platform, session, body):
        raise ServiceError(422, {"issues": [{"field": "check", "message": "请先测试当前配置；配置或资源变更后需要重新测试"}]})


def interrupt_checks(platform) -> None:
    with platform.db.session() as session:
        session.execute(
            update(m.TaskCheck)
            .where(m.TaskCheck.status.in_(("queued", "running")))
            .values(
                status="failed",
                finished_at=m.now(),
                results=[{"field": "check", "resource": "配置测试", "status": "failed", "message": "服务重启中断了测试，请重新测试"}],
            )
        )


def run(platform, check_id: str, body: TaskConfigIn) -> None:
    results: list[CheckResult] = []

    def result(field: str, resource: str, status: Literal["passed", "failed", "skipped"], message: str) -> None:
        results.append(CheckResult(field=field, resource=resource, status=status, message=message))
        with platform.db.session() as session:
            row = get(session, check_id)
            row.results = [entry.model_dump() for entry in results]

    def attempt(field: str, label: str, call: Callable[[], str]) -> bool:
        try:
            message = call()
            result(field, label, "passed", message)
            return True
        except (ValueError, OSError, ModelError, StepFailed, ServiceError) as error:
            message = str(error) if not isinstance(error, OSError) else "数据文件无法读取，请恢复或重新上传"
            result(field, label, "failed", message[:500])
            return False

    try:
        with platform.db.session() as session:
            get(session, check_id).status = "running"
            issues, prepared = validate(platform, session, body)
        if issues or prepared is None:
            for issue in issues:
                result(issue.field, "任务配置", "failed", issue.message)
            return
        algorithm = prepared.algorithm
        task_type = platform.registry.task_type(body.task_type)
        records = {}
        for site in prepared.sites:
            if site.dataset.source == "local":
                result("participants", site.dataset.name, "skipped", "已核对在线状态、算法版本与上报样本；原始文件由本地客户端校验，平台未读取")
                continue

            def check_data(site=site):
                rows = platform.files.load(site.dataset.content_path or "")
                raw = (platform.settings.datasets_dir / (site.dataset.content_path or "")).read_bytes()
                report = check_file(task_type, raw)
                if not report.ok:
                    raise ValueError(report.issues[0].message if report.issues else "没有可用样本")
                records[site.participant.id] = [row for row in rows if task_type.item_id(row) in site.items]
                return f"{report.count} 条样本的结构、标注规则与文件完整性通过"

            attempt("participants", site.dataset.name, check_data)
        refs = {site.model_ref for site in prepared.sites if body.execution == "builtin" and site.participant.hosting == "platform"}
        if any(step.at == "server" and step.model for step in algorithm.manifest.steps):
            refs.add(body.server_model)
        for ref in sorted(refs):

            def check_model(ref=ref):
                endpoint, model = platform.gateway.resolve(ref)
                settings = {**algorithm.model_settings(), "max_tokens": 128}
                reply = platform.gateway.probe(endpoint.id, model, settings)
                if not reply.text.strip():
                    raise ValueError("模型返回为空，请检查模型与生成参数")
                return "实际推理请求通过"

            attempt("models", ref, check_model)
        if body.execution == "agent":
            for site in prepared.sites:
                agent_id = body.agent_overrides.get(site.participant.id) or body.agent_id
                if not agent_id or site.participant.id not in records:
                    continue

                def check_agent(agent_id=agent_id, site=site):
                    gateway = AgentGateway(platform)
                    cap = gateway.capabilities(agent_id)
                    if not compatible(cap, algorithm):
                        raise ValueError("Agent 未声明支持当前算法的版本与全部参与方步骤")
                    with platform.db.session() as session:
                        endpoint = session.get(m.AgentEndpoint, agent_id)
                        if endpoint:
                            endpoint.capabilities = cap.model_dump(mode="json")
                    step = algorithm.manifest.step(algorithm.manifest.evaluation.step) if algorithm.manifest.evaluation else None
                    if step is None or step.per != "item":
                        raise ValueError("当前算法尚未提供可用于接入测试的单条评估步骤")
                    rows = records[site.participant.id]
                    record = next((row for row in rows if row.get("split") == "eval"), rows[0])
                    item = to_item(task_type, record, labels=False)
                    body_remote = AgentRequest(
                        run_id="pending",
                        algorithm=algorithm.id,
                        version=algorithm.version,
                        task_type=body.task_type,
                        task_id=check_id,
                        site_id=site.participant.id,
                        role=step.at,
                        round=1,
                        rounds=body.rounds,
                        step=step.id,
                        unit_key=item.id,
                        params=algorithm.manifest.params_of(body.params),
                        items=[item],
                    )
                    status = gateway.execute(agent_id, body_remote, timeout=180)
                    assert status.result is not None
                    ctx = context_of(body_remote, algorithm)
                    value = validate_result(status.result, ctx, {})
                    if not value.predictions or any(prediction is None or prediction == "" for _, prediction in value.predictions):
                        raise ValueError("Agent 未返回可用于平台评估的预测，请检查输出适配")
                    return "能力声明、真实样本执行与预测格式通过"

                attempt("models", f"{site.dataset.name} · Agent", check_agent)
        with platform.db.session() as session:
            if get(session, check_id).fingerprint != fingerprint(platform, session, body):
                result("check", "配置版本", "failed", "测试期间资源发生变化，请重新测试")
    except Exception:
        # 不把任意远程异常正文和凭据写回页面。
        result("check", "配置测试", "failed", "测试意外中断，请检查服务日志后重试")
    finally:
        if AgentGateway(platform).stop_check(check_id):
            results.append(CheckResult(field="models", resource="Agent 停止确认", status="failed",
                message="测试已结束，部分 Agent 尚未确认停止；恢复服务后到 Agent 接口检查能力以同步停止状态"))
        with platform.db.session() as session:
            row = get(session, check_id)
            row.status = "failed" if not results or any(entry.status == "failed" for entry in results) else "passed"
            row.results = [entry.model_dump() for entry in results]
            row.finished_at = m.now()
