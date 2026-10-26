from __future__ import annotations

from dataclasses import dataclass, field

from fedagent_sdk import SERVER, Algorithm, ModelError, SiteSpec, TaskSpec
from sqlalchemy.orm import Session

from .. import models as m
from ..data import select_items
from ..gateway import parse_ref
from ..platform import Platform
from ..resource_services.verification import agent_verified, endpoint_verified
from ..resources import dataset_ready, participant_status
from ..schemas import EstimateOut, IssueOut, TaskConfigIn

STATUS_LABELS = {"waiting": "还没有连接客户端", "offline": "已离线"}


@dataclass
class PreparedSite:
    participant: m.Participant
    dataset: m.Dataset
    items: list[str]
    labeled: int
    model_ref: str
    agent_id: str | None = None


@dataclass
class Prepared:
    algorithm: Algorithm
    sites: list[PreparedSite] = field(default_factory=list)


def _items_of(platform: Platform, dataset: m.Dataset, cap: int | None) -> tuple[list[str], int]:
    task_type = platform.registry.task_type(dataset.task_type)
    if dataset.source == "local":
        ids = [str(item) for item in dataset.item_ids or []]
        chosen = select_items(ids, cap)
        labeled = round(len(chosen) * dataset.answered / max(dataset.count, 1)) if dataset.count else 0
        return chosen, min(labeled, len(chosen))
    rows = platform.files.load(dataset.content_path or "")
    chosen_rows = rows[:cap] if cap else rows
    return [task_type.item_id(row) for row in chosen_rows], sum(1 for row in chosen_rows if task_type.is_labeled(row))


def validate(platform: Platform, session: Session, body: TaskConfigIn) -> tuple[list[IssueOut], Prepared | None]:
    registry = platform.registry
    issues: list[IssueOut] = []

    def issue(field_name: str, message: str) -> None:
        issues.append(IssueOut(field=field_name, message=message))

    scenario = registry.scenario(body.scenario)
    if scenario is None:
        issue("scenario", "场景不存在")
    elif not registry.scenario_available(body.scenario):
        issue("scenario", f"{scenario.short}的算法还在规划中")
    algorithm = registry.algorithms.get(body.algorithm)
    if body.task_type not in registry.task_types:
        issue("taskType", "任务类型没有安装")
    if algorithm is None:
        issue("algorithm", "算法没有安装")
        return issues, None
    manifest = algorithm.manifest
    if body.execution == "agent" and not manifest.agent_supported:
        issue("models", "该算法使用数据与 LLM，由平台执行流程，无需接入 Agent 接口")
    if manifest.agent_required and body.execution != "agent":
        issue("models", "该算法需要 Agent 系统，请选择 Agent 接口；LLM 接口不能替代完整 Agent")
    if manifest.scenario != body.scenario:
        issue("algorithm", "这个算法不属于所选的场景")
    if body.task_type not in manifest.accepts:
        issue("taskType", "这个算法不能处理所选的任务类型")
    if not manifest.rounds.min <= body.rounds <= manifest.rounds.max:
        issue("rounds", f"轮次应在 {manifest.rounds.min}–{manifest.rounds.max} 轮之间")
    for problem in manifest.check_params(body.params):
        issue("params", problem)
    if body.mode == "trial" and body.trial_cap < 1:
        issue("rounds", "试跑每份至少取 1 条样本")
    if body.grader is not None and body.task_type in registry.task_types and body.grader not in registry.task_type(body.task_type).graders:
        issue("taskType", "这种任务类型没有所选的判分方式")

    prepared = Prepared(algorithm=algorithm)
    seen: set[str] = set()
    cap = body.trial_cap if body.mode == "trial" else None
    for choice in body.participants:
        participant = session.get(m.Participant, choice.participant_id)
        dataset = session.get(m.Dataset, choice.dataset_id)
        if participant is None or dataset is None or dataset.participant_id != participant.id:
            issue("participants", "所选的参与方或数据集不存在")
            continue
        if participant.id in seen:
            issue("participants", f"{participant.name} 只能出一份数据集")
            continue
        seen.add(participant.id)
        if dataset.task_type != body.task_type:
            issue("participants", f"{dataset.name} 的任务类型和所选算法要求不一致")
            continue
        if dataset.schema_version != registry.task_type(body.task_type).schema_version:
            issue("participants", f"{dataset.name} 的数据规范版本不兼容，请按当前模板重新上传或登记")
            continue
        if dataset.resource_space != "workspace" and not dataset.shared:
            issue("participants", f"数据“{dataset.name}”已取消共享，请重新选择")
            continue
        if not dataset_ready(dataset):
            issue("participants", f"{dataset.name} 还没有样本（{'客户端连上后上报' if dataset.source == 'local' else '题目文件待导入'}）")
            continue
        status = participant_status(platform, participant)
        if status != "online":
            issue("participants", f"{participant.name} {STATUS_LABELS.get(status, status)}，连上后才能加入任务")
            continue
        if participant.hosting == "local" and participant.client_plugins.get(algorithm.id) != algorithm.version:
            issue("participants", f"{participant.name} 需要安装 {manifest.name} {algorithm.version} 并重新连接客户端")
            continue
        try:
            items, labeled = _items_of(platform, dataset, cap)
        except (OSError, ValueError) as error:
            issue("participants", f"{dataset.name} 的数据文件无法读取，请恢复数据备份（{type(error).__name__}）")
            continue
        if not items:
            issue("participants", f"{dataset.name} 没有可用的样本")
            continue
        model_ref = body.client_overrides.get(participant.id) or body.client_model
        prepared.sites.append(PreparedSite(participant, dataset, items, labeled, model_ref))
    if len(prepared.sites) < manifest.min_participants:
        issue("participants", f"至少选择 {manifest.min_participants} 组可用资源" if manifest.agent_required
              else f"至少选择 {manifest.min_participants} 个可用的数据来源，每个来源选择一份数据")

    if body.execution == "agent":
        from ..agents.protocol import Capabilities
        from ..agents.resources import compatible

        if body.budget is not None:
            issue("models", "外部 Agent 的费用由其服务管理，暂不能设置平台总费用上限")
        selected_agents: set[str] = set()
        for site in prepared.sites:
            if site.participant.hosting == "local":
                issue("participants", "自有 Agent 当前使用已上传的数据，请选择平台可读取的数据")
                continue
            agent_id = body.agent_overrides.get(site.participant.id) or body.agent_id
            site.agent_id = agent_id
            endpoint = session.get(m.AgentEndpoint, agent_id) if agent_id else None
            if endpoint is None:
                issue("models", "请为每个参与系统选择 Agent 接口")
            elif not endpoint.capabilities:
                issue("models", f"Agent“{endpoint.name}”尚未完成能力检查，请先在 Agent 接口页面检查")
            elif manifest.agent_required and endpoint.owner_id != site.dataset.owner_id:
                issue("participants", f"Agent“{endpoint.name}”与病例“{site.dataset.name}”不属于同一方，请重新选择")
            elif manifest.agent_required and agent_id in selected_agents:
                issue("models", "每个参与系统需使用不同的 Agent 接口")
            elif endpoint.capabilities and not compatible(Capabilities.model_validate(endpoint.capabilities), algorithm):
                issue("models", f"Agent“{endpoint.name}”不支持该算法的版本或完整步骤")
            elif not agent_verified(platform, session, endpoint, algorithm, body.task_type):
                issue("models", f"Agent“{endpoint.name}”尚未通过接入验证，请到 Agent 接口页完成验证")
            if endpoint:
                selected_agents.add(endpoint.id)
                for resource, label in ((endpoint, "Agent"), (site.dataset, "病例")):
                    if resource.resource_space != "workspace" and not resource.shared:
                        issue("participants", f"{label}“{resource.name}”已取消共享，请重新选择")
    refs = {site.model_ref for site in prepared.sites if site.participant.hosting == "platform" and body.execution == "builtin"}
    if any(step.at == SERVER and step.model for step in manifest.steps):
        refs.add(body.server_model)
    for ref in sorted(refs):
        try:
            endpoint, _ = platform.gateway.resolve(ref)
            row = session.get(m.Endpoint, parse_ref(ref)[0])
            if row and not endpoint_verified(row):
                issue("models", f"LLM“{row.name}”尚未通过接入验证，请到 LLM 接口页验证")
            if row and row.resource_space != "workspace" and not row.shared:
                issue("models", f"LLM 接口“{row.name}”已取消共享，请重新选择")
            if body.budget is not None and endpoint.kind != "fake" and endpoint.price is None:
                issue("models", f"设置费用上限前，请先登记接口“{endpoint.name}”的单价")
        except ModelError as error:
            issue("models", str(error))
    if not issues:
        for problem in algorithm.validate(_spec(body, prepared)):
            issue(problem.field, problem.message)
    return issues, prepared


def _spec(body: TaskConfigIn, prepared: Prepared) -> TaskSpec:
    role = next(iter(prepared.algorithm.manifest.roles))
    return TaskSpec(
        scenario=body.scenario,
        task_type=body.task_type,
        rounds=body.rounds,
        params=prepared.algorithm.manifest.params_of(body.params),
        sites=[SiteSpec(site.participant.id, role, len(site.items), site.labeled) for site in prepared.sites],
        workers=body.workers,
    )


def _price(platform: Platform, ref: str) -> float | None:
    try:
        endpoint, _ = platform.gateway.resolve(ref)
    except ModelError:
        return None
    return 0.0 if endpoint.kind == "fake" else endpoint.price


def estimate(platform: Platform, body: TaskConfigIn, prepared: Prepared) -> EstimateOut:
    spec = _spec(body, prepared)
    result = prepared.algorithm.estimate(spec)
    problems = sum(len(site.items) for site in prepared.sites)
    cost: float | None = 0.0
    if problems and result.participant_tokens:
        for site in prepared.sites:
            price = _price(platform, site.model_ref) if site.participant.hosting == "platform" else 0.0
            if price is None:
                cost = None
                break
            cost += result.participant_tokens * len(site.items) / problems * price / 1_000_000
    if cost is not None and result.server_tokens:
        price = _price(platform, body.server_model)
        cost = None if price is None else cost + result.server_tokens * price / 1_000_000
    return EstimateOut(
        remote_execution=body.execution == "agent",
        problems=problems,
        participant_calls=result.participant_calls,
        calls_are_upper_bound=result.calls_are_upper_bound,
        server_calls=result.server_calls,
        participant_tokens=result.participant_tokens,
        server_tokens=result.server_tokens,
        seconds=result.seconds,
        cost=None if body.execution == "agent" else cost,
    )
