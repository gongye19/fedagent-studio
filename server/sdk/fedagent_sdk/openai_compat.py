"""OpenAI 兼容的 /chat/completions：平台的模型网关和参与方客户端共用的请求和解析规则。

- 一律用流式（stream）请求：模型边生成边返回，连接一直有数据，经 Cloudflare 这类代理时不会因为
  "100 秒内没有响应"被断开（返回 524）；最后一块带 token 用量（stream_options.include_usage）。
- 不支持流式的接口返回普通 JSON 时照样解析。
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any


def retryable(status: int) -> bool:
    """暂时性的错误：超时、限流、服务端错误（包括 Cloudflare 的 520–524）。"""
    return status in {408, 409, 425, 429} or (500 <= status < 600 and status not in {501, 505})


def streaming(body: dict[str, Any]) -> dict[str, Any]:
    """请求体改成流式，并要求最后一块带上 token 用量。"""
    return {**body, "stream": True, "stream_options": {"include_usage": True}}


@dataclass
class Reply:
    text: str = ""
    model: str | None = None
    finish_reason: str | None = None
    usage: dict[str, int] = field(default_factory=dict)
    tool_calls: bool = False
    error: str | None = None
    """流里出现的错误（有的接口出错时在流里发一个 error 对象）。"""

    @property
    def empty(self) -> bool:
        """空回答、不计 token、也没有工具调用：多半是接口暂时出错，应当重试，不能当成功的调用。"""
        return not self.text.strip() and not self.usage.get("completion_tokens") and not self.tool_calls


def _usage(raw: Any) -> dict[str, int]:
    if not isinstance(raw, dict):
        return {}
    return {"prompt_tokens": int(raw.get("prompt_tokens") or 0), "completion_tokens": int(raw.get("completion_tokens") or 0)}


def _text(content: Any) -> str:
    if isinstance(content, list):
        return "".join(part.get("text", "") for part in content if isinstance(part, dict))
    return str(content or "")


def read_stream(lines: Iterable[str]) -> Reply:
    """解析服务器推送的事件流（每行 `data: {...}`，以 `data: [DONE]` 结束）。"""
    reply = Reply()
    parts: list[str] = []
    for raw in lines:
        line = raw.strip()
        if not line.startswith("data:"):
            continue  # 空行、注释（`:` 开头）、event 行
        data = line[5:].strip()
        if data == "[DONE]":
            break
        try:
            chunk = json.loads(data)
        except ValueError:
            continue
        if not isinstance(chunk, dict):
            continue
        if chunk.get("error"):
            error = chunk["error"]
            reply.error = str(error.get("message") if isinstance(error, dict) else error)
            break
        reply.model = chunk.get("model") or reply.model
        for choice in chunk.get("choices") or []:
            delta = choice.get("delta") or choice.get("message") or {}
            parts.append(_text(delta.get("content")))
            reply.tool_calls = reply.tool_calls or bool(delta.get("tool_calls"))
            reply.finish_reason = choice.get("finish_reason") or reply.finish_reason
        if chunk.get("usage"):
            reply.usage = _usage(chunk["usage"])
    reply.text = "".join(parts)
    return reply


def read_json(data: Any) -> Reply:
    """接口没有按流式返回、而是一次返回整个结果时的解析。"""
    choice = data["choices"][0]
    message = choice.get("message") or {}
    return Reply(
        text=_text(message.get("content")),
        model=data.get("model"),
        finish_reason=choice.get("finish_reason"),
        usage=_usage(data.get("usage")),
        tool_calls=bool(message.get("tool_calls")),
    )


def error_text(text: str, content_type: str = "", limit: int = 300) -> str:
    """接口返回的错误原因：JSON 里的 error.message；HTML 错误页（例如 Cloudflare 的 524）取标题；否则取开头一段。"""
    try:
        data = json.loads(text)
    except ValueError:
        data = None
    if isinstance(data, dict):
        error = data.get("error")
        for value in (error.get("message") if isinstance(error, dict) else error, data.get("message"), data.get("detail")):
            if isinstance(value, str) and value.strip():
                return _snippet(value, limit)
    if "html" in content_type or text.lstrip().lower().startswith(("<!doctype", "<html")):
        title = re.search(r"<title[^>]*>(.*?)</title>", text, re.IGNORECASE | re.DOTALL)
        if title and title.group(1).strip():
            return _snippet(title.group(1), limit)
    return _snippet(text, limit)


def _snippet(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit] + "…"
