"""一个模型的请求与调用账本；接口选择与并发控制由 Gateway 提供。"""

from __future__ import annotations

import hashlib
import json
import random
import threading
import time
from typing import TYPE_CHECKING, Any

import httpx
from fedagent_sdk import Algorithm, ChatResult, ModelError
from fedagent_sdk.openai_compat import error_text, read_json, read_stream, retryable, streaming
from sqlalchemy import select

from .models import CallRecord

if TYPE_CHECKING:
    from .gateway import EndpointConfig, Gateway, LedgerKey


def request_hash(body: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def prompt_text(prompt: str | list[dict[str, Any]]) -> str:
    if isinstance(prompt, str):
        return prompt
    return "\n\n".join(str(message.get("content", "")) for message in prompt)


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
        with self.gateway.slot(endpoint, wait_timeout=5 if self.purpose == "test" else None), self.gateway.client(endpoint) as client:
            attempt = 0
            while attempt <= endpoint.max_retries:
                if attempt:
                    time.sleep(min(2 ** (attempt - 1), 30) + random.random())
                attempt += 1
                try:
                    with client.stream("POST", url, json=streaming(body) if stream else body, headers=headers) as response:
                        content_type = response.headers.get("content-type", "")
                        if response.status_code >= 400:
                            reason = error_text(response.read().decode(errors="replace"), content_type)
                            last_error = f"接口返回 {response.status_code}：{reason}"
                            if stream and response.status_code in (400, 422) and "stream" in reason.lower():
                                stream = False  # 不支持流式参数的接口：改用普通请求
                                attempt -= 1  # 协议兼容回退不消耗失败重试次数。
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
