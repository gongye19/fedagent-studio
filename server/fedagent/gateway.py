"""模型网关：平台侧的模型调用都经过这里。

- 接口：OpenAI 兼容的 /chat/completions（DeepSeek、智谱、阿里云百炼、OpenRouter、自建 vLLM 都可以接）；
- 限流：同一台主机上的 API 和任务进程共用接口并发上限；失败按接口的重试次数指数退避重试；
- 调用账本：每次调用记一行（任务、站点、步骤、工作单元、token、耗时、费用、请求哈希、结果）。
  同一个工作单元里的第 n 次调用如果请求哈希没变，续跑时直接取账本里的结果，不重复计费；
- 假模型：kind 为 fake 的接口不发请求，按请求哈希返回固定内容；插件可以为自己的步骤给出格式正确的假回答。
"""

from __future__ import annotations

import fcntl
import hashlib
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import httpx
from fedagent_sdk import Algorithm, ChatResult, ModelError
from fedagent_sdk.openai_compat import error_text

from .crypto import SecretBox
from .db import Database
from .model_runtime import GatewayModel, _snippet
from .model_runtime import prompt_text as prompt_text
from .model_runtime import request_hash as request_hash
from .models import Endpoint

DEFAULT_REF = "default"
DEFAULT_ENDPOINT = "default"
FAKE_ENDPOINT = "fake"


@dataclass(frozen=True)
class EndpointConfig:
    id: str
    name: str
    kind: str
    base_url: str
    models: tuple[str, ...]
    concurrency: int
    price: float | None
    api_key: str | None
    timeout: float
    max_retries: int

    @property
    def configured(self) -> bool:
        return self.kind == "fake" or (bool(self.base_url.strip()) and bool(self.models))


@dataclass(frozen=True)
class LedgerKey:
    """调用属于哪个工作单元；续跑时按它和调用顺序找账本里的结果。"""

    task_id: str
    site_id: str
    round: int
    step: str
    unit_key: str


def parse_ref(ref: str) -> tuple[str, str | None]:
    """模型引用：default（默认接口的第一个模型）或 接口 id:模型名。"""
    if ref == DEFAULT_REF:
        return DEFAULT_ENDPOINT, None
    endpoint_id, _, model = ref.partition(":")
    if not endpoint_id or not model:
        raise ModelError(f"模型引用不合法：{ref}")
    return endpoint_id, model


class Gateway:
    def __init__(self, db: Database, secrets: SecretBox, *, transport: httpx.BaseTransport | None = None) -> None:
        self.db = db
        self.secrets = secrets
        self._transport = transport
        self._semaphores: dict[str, threading.BoundedSemaphore] = {}
        self._lock = threading.Lock()

    def endpoint(self, endpoint_id: str) -> EndpointConfig:
        with self.db.session() as session:
            row = session.get(Endpoint, endpoint_id)
            if row is None:
                raise ModelError(f"模型接口 {endpoint_id} 不存在")
            return EndpointConfig(
                id=row.id,
                name=row.name,
                kind=row.kind,
                base_url=row.base_url,
                models=tuple(row.models or ()),
                concurrency=max(1, row.concurrency),
                price=row.price,
                api_key=self.secrets.decrypt(row.api_key_enc),
                timeout=row.timeout,
                max_retries=row.max_retries,
            )

    def resolve(self, ref: str) -> tuple[EndpointConfig, str]:
        endpoint_id, model = parse_ref(ref)
        endpoint = self.endpoint(endpoint_id)
        if not endpoint.configured:
            raise ModelError(f"模型接口“{endpoint.name}”还没有配置地址和模型")
        if model is None:
            model = endpoint.models[0]
        elif endpoint.kind != "fake" and model not in endpoint.models:
            raise ModelError(f"模型接口“{endpoint.name}”没有登记模型 {model}")
        return endpoint, model

    def model(
        self,
        ref: str,
        *,
        ledger: LedgerKey | None = None,
        purpose: str = "task",
        plugin: Algorithm | None = None,
        step_id: str | None = None,
    ) -> GatewayModel:
        endpoint, model = self.resolve(ref)
        return GatewayModel(self, endpoint, model, ledger=ledger, purpose=purpose, plugin=plugin, step_id=step_id)

    def semaphore(self, endpoint: EndpointConfig) -> threading.BoundedSemaphore:
        with self._lock:
            semaphore = self._semaphores.get(endpoint.id)
            if semaphore is None:
                semaphore = threading.BoundedSemaphore(endpoint.concurrency)
                self._semaphores[endpoint.id] = semaphore
            return semaphore

    def client(self, endpoint: EndpointConfig) -> httpx.Client:
        return httpx.Client(timeout=httpx.Timeout(endpoint.timeout, connect=30.0), transport=self._transport)

    @contextmanager
    def slot(self, endpoint: EndpointConfig, *, wait_timeout: float | None = None) -> Iterator[None]:
        """文件锁在进程退出时自动释放；SQLite 部署的所有进程共享同一组槽位。"""
        database = self.db.engine.url.database
        if self.db.engine.url.get_backend_name() != "sqlite" or not database or database == ":memory:":
            semaphore = self.semaphore(endpoint)
            if not semaphore.acquire(timeout=wait_timeout):
                raise ModelError("模型接口繁忙，请稍后重新测试")
            try:
                yield
            finally:
                semaphore.release()
            return
        directory = Path(database).parent / ".model-slots"
        directory.mkdir(mode=0o700, exist_ok=True)
        prefix = hashlib.sha256(endpoint.id.encode()).hexdigest()
        started = time.monotonic()
        while True:
            for index in range(endpoint.concurrency):
                handle = (directory / f"{prefix}-{index}").open("a")
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    handle.close()
                    continue
                try:
                    yield
                finally:
                    handle.close()
                return
            if wait_timeout is not None and time.monotonic() - started >= wait_timeout:
                raise ModelError("模型接口繁忙，请稍后重新测试")
            time.sleep(0.05)

    def list_models(self, endpoint_id: str) -> list[str]:
        """接口提供的模型（OpenAI 兼容的 GET /models）。"""
        endpoint = self.endpoint(endpoint_id)
        if endpoint.kind == "fake":
            return list(endpoint.models)
        return self.list_models_at(endpoint.base_url, endpoint.api_key)

    def list_models_at(self, base_url: str, api_key: str | None) -> list[str]:
        """按地址和密钥读模型列表；新增、编辑接口时还没保存也能读。"""
        if not base_url.strip():
            raise ModelError("还没有填接口地址")
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        try:
            with httpx.Client(timeout=httpx.Timeout(30.0), transport=self._transport) as client:
                response = client.get(base_url.strip().rstrip("/") + "/models", headers=headers)
        except (httpx.TimeoutException, httpx.TransportError) as error:
            raise ModelError(f"连接失败：{type(error).__name__}") from error
        if response.status_code >= 400:
            raise ModelError(f"接口返回 {response.status_code}：{error_text(response.text, response.headers.get('content-type', ''))}")
        try:
            items = response.json().get("data") or []
            return sorted({str(item["id"]) for item in items if isinstance(item, dict) and item.get("id")})
        except (ValueError, AttributeError, TypeError) as error:
            raise ModelError(f"模型列表无法解析：{_snippet(response.text)}") from error

    def probe(self, endpoint_id: str, model: str, settings: dict[str, Any]) -> ChatResult:
        """按给定的生成参数发一条短请求；失败直接反馈，由用户决定重试。"""
        endpoint = replace(self.endpoint(endpoint_id), max_retries=0, timeout=30.0)
        return GatewayModel(self, endpoint, model, ledger=None, purpose="test", plugin=None, step_id=None).chat("Reply with OK.", **settings)
