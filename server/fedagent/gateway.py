"""模型网关：平台侧的模型调用都经过这里。

- 接口：OpenAI 兼容的 /chat/completions（DeepSeek、智谱、阿里云百炼、OpenRouter、自建 vLLM 都可以接）；
- 限流：每个接口按并发上限排队（进程内）；失败按接口的重试次数指数退避重试；
- 调用账本：每次调用记一行（任务、站点、步骤、工作单元、token、耗时、费用、请求哈希、结果）。
  同一个工作单元里的第 n 次调用如果请求哈希没变，续跑时直接取账本里的结果，不重复计费；
- 假模型：kind 为 fake 的接口不发请求，按请求哈希返回固定内容；插件可以为自己的步骤给出格式正确的假回答。
"""

from __future__ import annotations

import hashlib
import json
import random
import threading
import time
from dataclasses import dataclass, replace
from typing import Any

import httpx
from fedagent_sdk import Algorithm, ChatResult, ModelError
from fedagent_sdk.openai_compat import error_text, read_json, read_stream, retryable, streaming
from sqlalchemy import select

from .crypto import SecretBox
from .db import Database
from .models import CallRecord, Endpoint

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


def request_hash(body: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def prompt_text(prompt: str | list[dict[str, Any]]) -> str:
    if isinstance(prompt, str):
        return prompt
    return "\n\n".join(str(message.get("content", "")) for message in prompt)


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
        """按给定的生成参数发一条很短的请求；只重试一次，检查时不久等。"""
        endpoint = replace(self.endpoint(endpoint_id), max_retries=1)
        return GatewayModel(self, endpoint, model, ledger=None, purpose="test", plugin=None, step_id=None).chat("Reply with OK.", **settings)


class GatewayModel:
    """一个模型（实现 SDK 的 Model）：绑定到某个工作单元的账本位置。"""

    def __init__(
        self,
        gateway: Gateway,
        endpoint: EndpointConfig,
        model: str,
        *,
        ledger: LedgerKey | None,
        purpose: str,
        plugin: Algorithm | None,
        step_id: str | None,
    ) -> None:
        self.gateway = gateway
        self.endpoint = endpoint
        self.name = model
        self.ledger = ledger
        self.purpose = purpose
        self.plugin = plugin
        self.step_id = step_id
        self._ordinal = 0
        self._lock = threading.Lock()

    def chat(
        self,
        prompt: str | list[dict[str, Any]],
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
        **extra: Any,
    ) -> ChatResult:
        messages = [{"role": "user", "content": prompt}] if isinstance(prompt, str) else prompt
        body: dict[str, Any] = {"model": self.name, "messages": messages}
        for key, value in (("max_tokens", max_tokens), ("temperature", temperature), ("top_p", top_p)):
            if value is not None:
                body[key] = value
        body.update(extra)
        digest = request_hash(body)
        with self._lock:
            self._ordinal += 1
            ordinal = self._ordinal
        cached = self._cached(ordinal, digest)
        if cached is not None:
            return cached
        started = time.monotonic()
        try:
            if self.endpoint.kind == "fake":
                text = self._fake(prompt_text(prompt), digest)
                usage = {"prompt_tokens": len(prompt_text(prompt)) // 4, "completion_tokens": len(text) // 4}
                result = ChatResult(text=text, model=self.name, usage=usage, finish_reason="stop")
            else:
                result = self._post(body)
        except ModelError as error:
            self._record(ordinal, digest, None, int((time.monotonic() - started) * 1000), str(error))
            raise
        self._record(ordinal, digest, result, int((time.monotonic() - started) * 1000), None)
        return result

    # —— 内部 ——

    def _cached(self, ordinal: int, digest: str) -> ChatResult | None:
        if self.ledger is None:
            return None
        key = self.ledger
        with self.gateway.db.session() as session:
            row = session.scalars(
                select(CallRecord)
                .where(
                    CallRecord.task_id == key.task_id,
                    CallRecord.site_id == key.site_id,
                    CallRecord.round == key.round,
                    CallRecord.step == key.step,
                    CallRecord.unit_key == key.unit_key,
                    CallRecord.ordinal == ordinal,
                    CallRecord.request_hash == digest,
                    CallRecord.status == "ok",
                )
                .order_by(CallRecord.id.desc())
                .limit(1)
            ).first()
            if row is None:
                return None
            response = row.response or {}
            return ChatResult(
                text=str(response.get("text", "")),
                model=row.model,
                usage={"prompt_tokens": row.prompt_tokens, "completion_tokens": row.completion_tokens},
                finish_reason=response.get("finish_reason"),
                cached=True,
            )

    def _record(self, ordinal: int, digest: str, result: ChatResult | None, latency_ms: int, error: str | None) -> None:
        key = self.ledger
        prompt_tokens = int(result.usage.get("prompt_tokens", 0)) if result else 0
        completion_tokens = int(result.usage.get("completion_tokens", 0)) if result else 0
        price = self.endpoint.price
        cost = (prompt_tokens + completion_tokens) * price / 1_000_000 if price is not None else None
        with self.gateway.db.session() as session:
            session.add(
                CallRecord(
                    task_id=key.task_id if key else None,
                    site_id=key.site_id if key else None,
                    round=key.round if key else None,
                    step=key.step if key else None,
                    unit_key=key.unit_key if key else None,
                    ordinal=ordinal,
                    purpose=self.purpose,
                    endpoint_id=self.endpoint.id,
                    model=self.name,
                    request_hash=digest,
                    response={"text": result.text, "finish_reason": result.finish_reason} if result else None,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    latency_ms=latency_ms,
                    cost=cost,
                    status="ok" if error is None else "error",
                    error=error,
                )
            )

    def _fake(self, text: str, digest: str) -> str:
        if self.plugin is not None:
            reply = self.plugin.fake_reply(self.step_id, text, digest)
            if reply is not None:
                return reply
        return f"（假模型的回答 {digest[:8]}）"

    def _post(self, body: dict[str, Any]) -> ChatResult:
        """发请求（流式），按接口的重试次数重试暂时性的错误。请求哈希按原始请求体算，和是否流式无关。"""
        endpoint = self.endpoint
        url = endpoint.base_url.rstrip("/") + "/chat/completions"
        headers = {"Content-Type": "application/json"}
        if endpoint.api_key:
            headers["Authorization"] = f"Bearer {endpoint.api_key}"
        stream = True
        last_error = ""
        with self.gateway.semaphore(endpoint), self.gateway.client(endpoint) as client:
            for attempt in range(endpoint.max_retries + 1):
                if attempt:
                    time.sleep(min(2 ** (attempt - 1), 30) + random.random())
                try:
                    with client.stream("POST", url, json=streaming(body) if stream else body, headers=headers) as response:
                        content_type = response.headers.get("content-type", "")
                        if response.status_code >= 400:
                            reason = error_text(response.read().decode(errors="replace"), content_type)
                            last_error = f"接口返回 {response.status_code}：{reason}"
                            if stream and response.status_code in (400, 422) and "stream" in reason.lower():
                                stream = False  # 不支持流式参数的接口：改用普通请求
                                continue
                            if retryable(response.status_code):
                                continue
                            raise ModelError(last_error)
                        if "text/event-stream" in content_type:
                            reply = read_stream(response.iter_lines())
                        else:
                            text = response.read().decode(errors="replace")
                            try:
                                reply = read_json(json.loads(text))
                            except (ValueError, KeyError, IndexError, TypeError) as error:
                                raise ModelError(f"接口返回的内容无法解析：{_snippet(text)}") from error
                except (httpx.TimeoutException, httpx.TransportError) as error:
                    last_error = f"连接失败：{type(error).__name__}"
                    continue
                if reply.error:
                    last_error = f"接口返回错误：{reply.error}"
                    continue
                if reply.empty:
                    # 有的中转在上游出错时回 200 和空回答、不计 token：当作暂时性错误重试，不记成成功的调用
                    last_error = "接口返回了空的回答"
                    continue
                return ChatResult(
                    text=reply.text,
                    model=str(reply.model or body["model"]),
                    usage={"prompt_tokens": reply.usage.get("prompt_tokens", 0), "completion_tokens": reply.usage.get("completion_tokens", 0)},
                    finish_reason=reply.finish_reason,
                )
        raise ModelError(f"重试 {endpoint.max_retries} 次后仍失败（{last_error}）")


def _snippet(text: str, limit: int = 300) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit] + "…"
