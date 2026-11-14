"""任务开始前只检查可达性，不执行算法、不发送病例和推理请求。"""
from dataclasses import replace

import httpx
from fedagent_sdk import ModelError

from ..agents.gateway import AgentGateway
from ..agents.resources import compatible


def model_connection(platform, endpoint_id: str) -> str:
    endpoint = platform.gateway.endpoint(endpoint_id)
    if endpoint.kind == "fake":
        return "连接正常"
    headers = {"Authorization": f"Bearer {endpoint.api_key}"} if endpoint.api_key else {}
    try:
        with platform.gateway.client(replace(endpoint, timeout=5)) as client:
            response = client.get(endpoint.base_url.rstrip("/") + "/models", headers=headers)
            # 接入验证已确认真实推理；不支持模型列表的服务只探测聊天路由，不生成文字。
            if response.status_code in (404, 405):
                response = client.head(endpoint.base_url.rstrip("/") + "/chat/completions", headers=headers)
                if response.status_code in (400, 405):
                    return "服务可达"
            if response.status_code >= 300:
                raise ModelError(f"接口返回 HTTP {response.status_code}，请在 LLM 接口页检查地址与鉴权")
        return "连接正常"
    except httpx.HTTPError as error:
        raise ModelError("LLM 接口连接超时或不可达，请在资源页重试验证") from error


def agent_connection(platform, agent_id, algorithm) -> str:
    cap = AgentGateway(platform, request_timeout=5).capabilities(agent_id)
    if not compatible(cap, algorithm):
        raise ValueError("接口能力已变更，请在 Agent 接口页重新验证")
    return "连接正常"
