"""Agent HTTP 网关：限制响应大小、禁用重定向、幂等运行与停止确认。"""

from __future__ import annotations

import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import uuid4

import httpx
from fedagent_sdk import ModelError, StepFailed
from pydantic import ValidationError
from sqlalchemy import select

from .. import models as m
from ..errors import ServiceError
from .protocol import MAX_BYTES, AgentRequest, Capabilities, RunStatus
from .resources import get


class AgentError(StepFailed):
    def __init__(self, message: str) -> None:
        super().__init__(message, pause=True)


class AgentBusy(AgentError):
    pass


class AgentGateway:
    def __init__(self, platform, *, transport: httpx.BaseTransport | None = None, request_timeout: float = 15) -> None:
        self.platform = platform
        self.transport = transport
        self.request_timeout = request_timeout

    def request(self, agent_id: str, method: str, path: str, body: Any = None) -> Any:
        with self.platform.db.session() as session:
            endpoint = get(session, agent_id)
            address = endpoint.base_url
            key = self.platform.secrets.decrypt(endpoint.api_key_enc)
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        started = time.monotonic()
        try:
            with (
                httpx.Client(transport=self.transport, timeout=5 if path.endswith("/cancel") else self.request_timeout,
                             follow_redirects=False, trust_env=False) as client,
                client.stream(method, address + path, headers=headers, json=body) as response,
            ):
                if response.status_code == 429:
                    raise AgentBusy("Agent 服务繁忙")
                if response.status_code >= 300:
                    raise AgentError(f"Agent 服务返回 HTTP {response.status_code}，请检查地址、鉴权与协议")
                data = bytearray()
                for chunk in response.iter_bytes():
                    if time.monotonic() - started > 30:
                        raise AgentError("Agent 响应传输超过 30 秒")
                    data.extend(chunk)
                    if len(data) > MAX_BYTES:
                        raise AgentError("Agent 返回超过 8 MB，请减小单次输出")
            value = json.loads(data)
            json.dumps(value, allow_nan=False)
            return value
        except (httpx.HTTPError, ValueError, UnicodeDecodeError, RecursionError) as error:
            # 不公开服务响应正文、请求头或含凭据的底层错误。
            raise AgentError(f"Agent 无法连接或未返回有效 JSON（{type(error).__name__}）") from error

    def capabilities(self, agent_id: str) -> Capabilities:
        try:
            return Capabilities.model_validate(self.request(agent_id, "GET", "/capabilities"))
        except ValidationError as error:
            raise AgentError("Agent 能力声明不符合 fedagent-agent/1 协议") from error

    def execute(self, agent_id: str, body: AgentRequest, *, unit_id: int | None = None, timeout: float = 900) -> RunStatus:
        if len(body.model_dump_json().encode()) + 100 > MAX_BYTES:
            raise AgentError("Agent 单次输入超过 8 MB，请减小数据或共享内容")
        digest = hashlib.sha256(json.dumps(body.model_dump(mode="json", exclude={"run_id"}), sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        with self.platform.db.session() as session:
            previous = (
                session.scalars(select(m.AgentRun).where(m.AgentRun.unit_id == unit_id).order_by(m.AgentRun.created_at.desc())).first() if unit_id else None
            )
            if previous and previous.status not in ("failed", "canceled"):
                if previous.request_hash != digest or previous.agent_id != agent_id:
                    raise AgentError("同一 Agent 工作单元的输入发生变化，请复制任务重新配置")
                run_id = previous.id
            else:
                run_id = ("run_" if unit_id else body.task_id + "_") + uuid4().hex
                session.add(m.AgentRun(id=run_id, task_id=body.task_id if unit_id else None, unit_id=unit_id, agent_id=agent_id, request_hash=digest))
        body = body.model_copy(update={"run_id": run_id})
        if len(body.model_dump_json().encode()) > MAX_BYTES:
            raise AgentError("Agent 单次输入超过 8 MB，请减小数据或共享内容")
        from .progress_collector import ProgressCollector

        collector = ProgressCollector(self.platform, self, agent_id, body, unit_id)
        started = time.monotonic()
        while True:
            try:
                data = self.request(agent_id, "POST", "/runs", body.model_dump(mode="json"))
                break
            except AgentBusy:
                if time.monotonic() - started >= timeout:
                    raise AgentError("Agent 持续繁忙，请降低并发后重试") from None
                time.sleep(1)
        while True:
            try:
                status = RunStatus.model_validate(data)
            except ValidationError as error:
                raise AgentError("Agent 运行结果格式不符合协议") from error
            if status.run_id != run_id:
                raise AgentError("Agent 返回了其他运行的结果")
            with self.platform.db.session() as session:
                row = session.get(m.AgentRun, run_id)
                if row:
                    row.status = status.status
            more = collector.pull(status.events_available)
            if status.status in ("succeeded", "failed", "canceled"):
                while more:
                    more = collector.pull(status.events_available)
            if status.status == "succeeded":
                if status.result is None:
                    raise AgentError("Agent 报告完成但缺少结果")
                return status
            if status.status == "failed":
                guidance = {
                    "diagnosis_incomplete": "Agent 在问诊上限内未形成最终诊断，请调整问诊回合上限后重新验证",
                    "model_error": "Agent 的内部模型调用失败，请检查接入方的 LLM 连接和额度",
                    "invalid_output": "Agent 的业务输出不完整，请按下载的算法输出规范检查服务实现",
                }.get(status.error_code or "", "Agent 执行失败，请检查该服务的运行记录")
                if status.retryable:
                    raise StepFailed(f"{guidance}（运行 {run_id}）", pause=False)
                raise AgentError(f"{guidance}（运行 {run_id}）")
            if status.status == "canceled":
                raise AgentError(f"Agent 执行已取消，请在该服务中检查运行 {run_id}")
            if time.monotonic() - started > timeout:
                raise AgentError("等待 Agent 结果超时；运行编号已保留，继续任务将查询同一次运行")
            time.sleep(0.2)
            data = self.request(agent_id, "GET", f"/runs/{run_id}")

    def _stop_runs(self, runs: list[tuple[str, str]]) -> int:
        def stop(entry: tuple[str, str]) -> int:
            run_id, agent_id = entry
            try:
                status = RunStatus.model_validate(self.request(agent_id, "POST", f"/runs/{run_id}/cancel"))
                if status.run_id != run_id:
                    raise AgentError("停止结果编号不匹配")
                with self.platform.db.session() as session:
                    row = session.get(m.AgentRun, run_id)
                    if row:
                        row.status = status.status
                return int(status.status not in ("succeeded", "failed", "canceled"))
            except (AgentError, ValidationError, ServiceError, ModelError):
                return 1

        with ThreadPoolExecutor(max_workers=4) as pool:
            return sum(pool.map(stop, runs))

    def stop_task(self, task_id: str) -> int:
        with self.platform.db.session() as session:
            rows = session.scalars(select(m.AgentRun).where(m.AgentRun.task_id == task_id, m.AgentRun.status.in_(("queued", "running", "canceling")))).all()
            runs = [(row.id, row.agent_id) for row in rows]
        return self._stop_runs(runs)

    def stop_check(self, check_id: str) -> int:
        with self.platform.db.session() as session:
            rows = session.scalars(
                select(m.AgentRun).where(
                    m.AgentRun.task_id.is_(None),
                    m.AgentRun.id.startswith(check_id + "_", autoescape=True),
                    m.AgentRun.status.in_(("queued", "running", "canceling")),
                )
            ).all()
            runs = [(row.id, row.agent_id) for row in rows]
        return self._stop_runs(runs)

    def reconcile(self, agent_id: str) -> None:
        """用户检查接口时，再次请求停止已结束任务／测试遗留的运行；不干扰活动任务。"""
        with self.platform.db.session() as session:
            runs = []
            for row in session.scalars(select(m.AgentRun).where(m.AgentRun.agent_id == agent_id, m.AgentRun.status.in_(("queued", "running", "canceling")))):
                owner = session.get(m.Task, row.task_id) if row.task_id else session.get(m.TaskCheck, row.id.split("_")[0])
                active = owner and owner.status in ("queued", "running")
                if not active:
                    runs.append((row.id, agent_id))
        self._stop_runs(runs)
