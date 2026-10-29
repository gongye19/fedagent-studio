"""独立服务可复用的 SDK 适配；Agent 也可以自行实现同一输入输出契约。"""

from fedagent_sdk import Artifact, Item, Message, SiteInfo, StepContext

from .protocol import AgentRequest


class PayloadIO:
    def __init__(self, body: AgentRequest) -> None:
        self.body = body

    def recall(self, key: str, item_id: str | None, round: int):
        return next((entry.value for entry in self.body.state if entry.key == key and entry.item_id == (item_id or None) and entry.round == round), None)

    def inbox(self, channel: str, round: int) -> list[Message]:
        return [entry for entry in self.body.inbox.get(channel, []) if entry.round == round]

    def artifact(self, before_round: int) -> Artifact | None:
        artifact = self.body.artifact
        return artifact if artifact and artifact.round < before_round else None

    def items(self) -> list[Item]:
        return self.body.items


def context_of(body: AgentRequest, algorithm, model=None, *, progress=None) -> StepContext:
    step = algorithm.manifest.step(body.step)
    if body.version != algorithm.version or step is None or step.at == "server" or step.at != body.role:
        raise ValueError("算法版本、执行角色或步骤不受支持")
    if (not algorithm.manifest.rounds.min <= body.rounds <= algorithm.manifest.rounds.max
            or not 1 <= body.round <= body.rounds or body.step not in algorithm.plan(body.round, body.rounds)):
        raise ValueError("执行组数或步骤不符合算法计划")
    item = next((item for item in body.items if item.id == body.unit_key), None) if step.per == "item" else None
    if step.per == "item" and item is None:
        raise ValueError("缺少工作单元的样本")
    return StepContext(
        manifest=algorithm.manifest,
        step=step,
        site=SiteInfo(body.site_id, body.role, body.site_id),
        round=body.round,
        rounds=body.rounds,
        params=algorithm.manifest.params_of(body.params),
        io=PayloadIO(body),
        model=model,
        item=item,
        progress=progress,
    )
