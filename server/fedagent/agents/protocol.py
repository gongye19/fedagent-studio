"""FedAgent Agent v1：按算法工作单元交换 JSON，不发送平台的模型凭据。"""

from __future__ import annotations

from typing import Any, Literal

from fedagent_sdk import Artifact, Item, Message, OutgoingMessage, UnitResult
from pydantic import BaseModel, ConfigDict, Field

PROTOCOL = "fedagent-agent/1"
MAX_BYTES = 8_000_000


class Wire(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class AlgorithmCapability(Wire):
    version: str
    steps: list[str]


class Capabilities(Wire):
    protocol: Literal["fedagent-agent/1"] = PROTOCOL
    algorithms: dict[str, AlgorithmCapability]


class SavedValue(Wire):
    key: str = Field(min_length=1, max_length=120)
    item_id: str | None = None
    round: int = Field(ge=1)
    value: Any


class AgentRequest(Wire):
    protocol: Literal["fedagent-agent/1"] = PROTOCOL
    run_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    algorithm: str
    version: str
    task_type: str
    task_id: str
    site_id: str
    role: str
    round: int = Field(ge=1)
    rounds: int = Field(ge=1)
    step: str
    unit_key: str
    params: dict[str, Any] = Field(default_factory=dict)
    items: list[Item] = Field(default_factory=list)
    state: list[SavedValue] = Field(default_factory=list)
    inbox: dict[str, list[Message]] = Field(default_factory=dict)
    artifact: Artifact | None = None


class AgentResult(Wire):
    kept: list[tuple[str, str | None, Any]] = Field(default_factory=list)
    sent: list[OutgoingMessage] = Field(default_factory=list)
    reports: dict[str, Any] = Field(default_factory=dict)
    predictions: list[tuple[str, Any]] = Field(default_factory=list)
    logs: list[str] = Field(default_factory=list)

    def unit_result(self) -> UnitResult:
        return UnitResult(**self.model_dump(exclude={"sent"}), sent=self.sent)


class RunStatus(Wire):
    run_id: str
    status: Literal["queued", "running", "succeeded", "failed", "canceling", "canceled"]
    result: AgentResult | None = None
    error: str | None = None
    retryable: bool = False


def document(registry) -> dict[str, Any]:
    """供用户下载的当前接入契约，不包含任何已登记的接口或凭据。"""
    return {
        "protocol": PROTOCOL,
        "instructions": [
            "服务地址追加以下路径，支持可选 Authorization: Bearer 鉴权；禁止重定向。",
            "POST /runs 应快速返回状态，同一 run_id 重提不能重复执行；GET 查询异步结果。",
            "只执行清单中的参与方步骤，平台负责中心汇总与独立判分。",
            "items 是本步骤授权的数据；state 为本任务本站点私有中间状态，artifact 为上一轮共享成果。",
            "必须符合具体算法步骤的 kept／sent／predictions 业务结构；仅返回聊天答案不代表支持联邦。",
            "平台不会发送自己的 LLM 密钥；Agent 内部模型和工具由接入方管理。",
            "当前使用已上传数据，选择接口会把步骤需要的样本发送到该服务；未实现远程文件引用。",
        ],
        "limits": {"requestBytes": MAX_BYTES, "responseBytes": MAX_BYTES, "messageBytes": 1_000_000},
        "endpoints": {
            "GET /capabilities": "返回能力声明，版本与全部参与方步骤须匹配。",
            "POST /runs": "幂等提交 AgentRequest，返回 RunStatus；完成时必须有 result。",
            "GET /runs/{run_id}": "查询同一编号的运行状态与结果，重启后仍可去重查询。",
            "POST /runs/{run_id}/cancel": "请求停止；确认后才返回 canceled，尚未确认返回 canceling。应保存尚未接收编号的取消标记。",
        },
        "capabilitiesSchema": Capabilities.model_json_schema(),
        "requestSchema": AgentRequest.model_json_schema(),
        "responseSchema": RunStatus.model_json_schema(),
        "algorithms": {algorithm.id: algorithm.manifest.model_dump(mode="json", by_alias=True) for algorithm in registry.algorithms.values()},
        "implementation": "参考当前算法插件与SDK的StepContext／UnitResult实现，代码安装包可从平台 /client/ 下载。",
    }
