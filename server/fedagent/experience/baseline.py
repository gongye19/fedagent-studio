"""用同一算法的聚合步骤和单站点消息构建本站对照经验。"""
from typing import Any

from fedagent_sdk import Artifact, Item, Message, StepContext, StepFailed
from fedagent_sdk.context import SiteInfo
from sqlalchemy import select, update

from .. import models as m
from ..gateway import LedgerKey
from ..platform import Platform


class LocalInbox:
    def __init__(self, messages: list[Message]):
        self.messages = messages
        self.kept: dict[str, Any] = {}

    def recall(self, key: str, item_id: str | None, round: int):
        return self.kept.get(key)

    def inbox(self, channel: str, round: int):
        return [message for message in self.messages if message.channel == channel and message.round == round]

    def artifact(self, before_round: int):
        return None

    def items(self) -> list[Item]:
        return []


def local_package(platform: Platform, task: m.Task, job: m.Task, site_id: str, artifact: Artifact) -> Any:
    algorithm = platform.registry.algorithm(task.algorithm)
    manifest = algorithm.manifest
    steps = [step for step in manifest.steps if step.at == "server"]
    channels = {channel for step in steps for channel in step.reads}
    with platform.db.session() as session:
        rows = session.scalars(select(m.Message).where(
            m.Message.task_id == task.id, m.Message.round == artifact.round,
            m.Message.sender_site == site_id, m.Message.channel.in_(channels),
        ).order_by(m.Message.id))
        messages = [Message(str(row.id), row.channel, row.round, row.step, row.sender_site,
                            row.sender_role, row.payload, row.item_id) for row in rows]
    if not messages:
        raise StepFailed("本站没有可用于对照的经验提取记录")
    io = LocalInbox(messages)
    for step in steps:
        model = platform.gateway.model(
            job.config["aggregation_model"], plugin=algorithm, step_id=step.id,
            purpose="experience-eval", ledger=LedgerKey(job.id, site_id, artifact.round, f"local-{step.id}", "package"),
        ) if step.model else None
        ctx = StepContext(manifest=manifest, step=step, site=SiteInfo("server", "server"),
                          round=artifact.round, rounds=1, params=task.config["params"], io=io, model=model)
        try:
            algorithm.run_step(ctx)
        except StepFailed:
            # 格式错误的成功调用不能在重试时原样回放。
            with platform.db.session() as session:
                session.execute(update(m.CallRecord).where(
                    m.CallRecord.task_id == job.id, m.CallRecord.site_id == site_id,
                    m.CallRecord.step == f"local-{step.id}", m.CallRecord.status == "ok",
                ).values(status="discarded"))
            raise
        io.kept.update({key: value for key, _, value in ctx.result.kept})
        if ctx.result.has_published:
            return ctx.result.published
    raise StepFailed("本站聚合未产生经验包")
