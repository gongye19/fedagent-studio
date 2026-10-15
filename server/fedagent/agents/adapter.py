"""把清单授权的输入交给 Agent，返回值再过能力和样本边界校验。"""

from __future__ import annotations

import json

from fedagent_sdk import Algorithm, StepContext, UnitResult
from sqlalchemy import select

from .. import models as m
from ..units import resolve_receiver
from .gateway import AgentError, AgentGateway
from .protocol import MAX_BYTES, AgentRequest, AgentResult, SavedValue


def request_of(ctx: StepContext, algorithm: Algorithm, task_type: str, task_id: str, unit_key: str, state: list[SavedValue]) -> AgentRequest:
    items = [ctx.item] if ctx.step.per == "item" else ctx.items()
    artifact = ctx.artifact() if ctx.manifest.artifact and ctx.site.role in ctx.manifest.artifact.to else None
    return AgentRequest(
        run_id="pending",
        algorithm=algorithm.id,
        version=algorithm.version,
        task_type=task_type,
        task_id=task_id,
        site_id=ctx.site.id,
        role=ctx.site.role,
        round=ctx.round,
        rounds=ctx.rounds,
        step=ctx.step.id,
        unit_key=unit_key,
        params=ctx.params,
        items=items,
        state=state,
        inbox={channel: ctx.inbox(channel) for channel in ctx.step.reads},
        artifact=artifact,
    )


def validate_result(result: AgentResult, ctx: StepContext, sites) -> UnitResult:
    if len(result.model_dump_json().encode()) > MAX_BYTES:
        raise AgentError("Agent 结果超过 8 MB")
    allowed = {ctx.item.id} if ctx.step.per == "item" else {item.id for item in ctx.items()}
    evaluation = ctx.manifest.evaluation
    if result.predictions and (evaluation is None or evaluation.step != ctx.step.id):
        raise AgentError("Agent 在非评估步骤返回了预测")
    ids = [item_id for item_id, _ in result.predictions]
    if len(ids) != len(set(ids)) or any(item_id not in allowed for item_id in ids):
        raise AgentError("Agent 预测重复或对应了其他样本")
    if any(name in result.reports for name in ("labeled", "correct")):
        raise AgentError("Agent 不能自行提交平台判分汇总")
    for key, item_id, _ in result.kept:
        if not key or len(key) > 120 or (item_id is not None and item_id not in allowed):
            raise AgentError("Agent 中间结果的键或样本编号无效")
    for message in result.sent:
        if message.channel not in ctx.step.sends or (message.item_id is not None and message.item_id not in allowed):
            raise AgentError("Agent 消息越过了声明的通道或样本边界")
        if len(json.dumps(message.payload, ensure_ascii=False).encode()) > 1_000_000:
            raise AgentError("Agent 单条交换消息超过 1 MB")
        try:
            resolve_receiver(ctx.manifest, message.channel, message.to, sites)
        except ValueError as error:
            raise AgentError(str(error)) from error
    return result.unit_result()


def execute(platform, ctx: StepContext, algorithm: Algorithm, task_type: str, task_id: str, unit_id: int, unit_key: str, agent_id: str, sites) -> UnitResult:
    with platform.db.session() as session:
        query = select(m.SiteState).where(m.SiteState.task_id == task_id, m.SiteState.site_id == ctx.site.id, m.SiteState.round <= ctx.round)
        if ctx.step.per == "item":
            query = query.where(m.SiteState.item_id.in_((unit_key, "")))
        state = [
            SavedValue(key=row.key, item_id=row.item_id or None, round=row.round, value=row.value)
            for row in session.scalars(query.order_by(m.SiteState.round, m.SiteState.key, m.SiteState.item_id))
        ]
    body = request_of(ctx, algorithm, task_type, task_id, unit_key, state)
    status = AgentGateway(platform).execute(agent_id, body, unit_id=unit_id)
    assert status.result is not None
    return validate_result(status.result, ctx, sites)
