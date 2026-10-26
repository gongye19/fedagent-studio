"""用最小真实样本执行完整本方流程；检查业务输出，不测准确率。"""
import time
from collections.abc import Callable

from .. import models as m
from ..agents.adapter import validate_result
from ..agents.gateway import AgentError, AgentGateway
from ..agents.protocol import AgentRequest, SavedValue
from ..agents.resources import compatible
from ..agents.runtime import context_of
from ..data import to_item

AGENT_CHECK_SECONDS = 300


def check_agent(platform, agent_id, algorithm, task_type, site, records, check_id, config,
                progress: Callable[[str], None] = lambda _: None) -> str:
    deadline = time.monotonic() + AGENT_CHECK_SECONDS
    progress("正在核对能力声明")
    gateway = AgentGateway(platform)
    cap = gateway.capabilities(agent_id)
    if not compatible(cap, algorithm):
        raise ValueError("Agent 未声明支持当前算法的版本与全部参与方步骤")
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
    for step in algorithm.manifest.steps:
        if step.at == "server":
            continue
        items = [to_item(task_type, row, labels=step.labels) for row in rows]
        for item in items if step.per == "item" else [None]:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError("Agent 配置测试超过 5 分钟，请检查服务负载或模型响应后重试")
            progress(f"正在执行{step.label} · 样本 {item.id}" if item else f"正在执行{step.label}")
            request = AgentRequest(
                run_id="pending", algorithm=algorithm.id, version=algorithm.version,
                task_type=config.task_type, task_id=check_id, site_id=site.participant.id,
                role=step.at, round=1, rounds=config.rounds, step=step.id,
                unit_key=item.id if item else "_", params=algorithm.manifest.params_of(config.params),
                items=[item] if item else items, state=state,
            )
            try:
                status = gateway.execute(agent_id, request, timeout=remaining)
            except AgentError:
                if time.monotonic() >= deadline:
                    raise ValueError("Agent 配置测试超过 5 分钟，请检查服务负载或模型响应后重试") from None
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
            uploads += len(value.sent)
            for key, item_id, saved in value.kept:
                state = [entry for entry in state if (entry.key, entry.item_id) != (key, item_id)]
                state.append(SavedValue(key=key, item_id=item_id, round=1, value=saved))
    if not predictions:
        raise ValueError("Agent 没有返回可供独立评估的预测")
    if not uploads:
        raise ValueError("Agent 未返回可参与联邦聚合的经验，请检查经验提取输出")
    return "能力声明、真实样本执行、全部本方步骤与经验格式通过；未评估准确率"
