"""用最小真实样本执行完整本方流程；检查业务输出，不测准确率。"""
import time
from collections.abc import Callable

from fedagent_sdk import Artifact, Message, SiteInfo, StepContext

from .. import models as m
from ..data import to_item
from .adapter import validate_result
from .gateway import AgentError, AgentGateway
from .protocol import AgentRequest, SavedValue
from .resources import compatible
from .runtime import PayloadIO, context_of

AGENT_CHECK_SECONDS = 900


def check_agent(platform, agent_id, algorithm, task_type, site, records, check_id, config,
                progress: Callable[[str], None] = lambda _: None,
                on_step: Callable[[str, str, str], None] = lambda *_: None) -> str:
    deadline = time.monotonic() + AGENT_CHECK_SECONDS
    progress("正在核对能力声明")
    gateway = AgentGateway(platform)
    cap = gateway.capabilities(agent_id)
    if not compatible(cap, algorithm):
        raise ValueError("Agent 未声明支持当前算法的版本与全部参与方步骤")
    on_step("capabilities", "接口协议", "passed")
    with platform.db.session() as session:
        endpoint = session.get(m.AgentEndpoint, agent_id)
        if endpoint:
            endpoint.capabilities = cap.model_dump(mode="json")
    rows = records[:algorithm.min_samples_per_site]
    if not rows:
        raise ValueError("没有可用于接入测试的样本")
    state: list[SavedValue] = []
    evaluation = algorithm.manifest.evaluation
    predictions = 0
    uploads = 0
    rounds = algorithm.manifest.rounds.default
    artifact = None
    sent = []
    # 按插件计划覆盖所有本方步骤，不把验证固定为两轮。
    extra = any(step.at != "server" and step.id not in algorithm.plan(1, rounds) for step in algorithm.manifest.steps)
    sequence = [(round, key) for round in range(1, rounds + 1 if extra else 2) for key in algorithm.plan(round, rounds)]
    for round, step_id in sequence:
        step = algorithm.manifest.step(step_id)
        assert step is not None
        if step.at == "server":
            if not extra:
                continue
            if step.model:
                raise ValueError("接入验证需要未配置的中心模型")
            request = AgentRequest(run_id="pending", algorithm=algorithm.id, version=algorithm.version,
                task_type=config.task_type, task_id=check_id, site_id="server", role="server", round=round, rounds=rounds,
                step=step.id, unit_key="_", params=algorithm.manifest.params_of(config.params),
                inbox={channel: [m for m in sent if m.channel == channel] for channel in step.reads})
            ctx = StepContext(manifest=algorithm.manifest, step=step, site=SiteInfo("server", "server", "server"),
                              round=round, rounds=rounds, params=request.params, io=PayloadIO(request))
            algorithm.run_step(ctx)
            if ctx.result.has_published:
                artifact = Artifact(1, round, algorithm.manifest.artifact.kind, ctx.result.published)
            continue
        on_step(step.id, step.label, "running")
        items = [to_item(task_type, row, labels=step.labels) for row in rows]
        for item in items if step.per == "item" else [None]:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError("Agent 接入验证超过 15 分钟，请检查服务负载或模型响应后重试")
            progress(f"正在执行{step.label} · 样本 {item.id}" if item else f"正在执行{step.label}")
            request = AgentRequest(
                run_id="pending", algorithm=algorithm.id, version=algorithm.version,
                task_type=config.task_type, task_id=check_id, site_id=site.participant.id,
                role=step.at, round=round, rounds=rounds, step=step.id,
                unit_key=item.id if item else "_", params=algorithm.manifest.params_of(config.params),
                items=[item] if item else items, state=state, artifact=artifact,
            )
            try:
                status = gateway.execute(agent_id, request, timeout=remaining)
            except AgentError:
                if time.monotonic() >= deadline:
                    raise ValueError("Agent 接入验证超过 15 分钟，请检查服务负载或模型响应后重试") from None
                raise
            if status.result is None:
                raise ValueError(f"Agent 的{step.label}没有返回结果")
            value = validate_result(status.result, context_of(request, algorithm), {}, algorithm)
            if evaluation and step.id == evaluation.step:
                expected = {i.id for i in request.items if i.get("split") != "learn"}
                actual = {key for key, prediction in value.predictions if isinstance(prediction, str) and prediction.strip()}
                if actual != expected:
                    raise ValueError(f"Agent 的{step.label}缺少有效预测")
                predictions += len(actual)
            for outgoing in value.sent:
                sent.append(Message(id=str(len(sent)), channel=outgoing.channel, sender=site.participant.id, sender_role=step.at,
                                    round=round, step=step.id, payload=outgoing.payload, item_id=outgoing.item_id))
            uploads += len(value.sent)
            for key, item_id, saved in value.kept:
                state = [entry for entry in state if (entry.key, entry.item_id) != (key, item_id)]
                state.append(SavedValue(key=key, item_id=item_id, round=round, value=saved))
        on_step(step.id, step.label, "passed")
    if not predictions:
        raise ValueError("Agent 没有返回可供独立评估的预测")
    if not uploads:
        raise ValueError("Agent 未返回可参与联邦聚合的经验，请检查经验提取输出")
    on_step("output", "输出规范", "passed")
    return "能力声明、真实样本执行、全部本方步骤与经验格式通过；未评估准确率"
