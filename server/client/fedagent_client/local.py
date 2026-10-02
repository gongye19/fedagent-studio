"""客户端本地的部分：数据集、私有中间结果、模型。这些都留在参与方的环境里，不上传。"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

import httpx
from fedagent_sdk import Algorithm, Artifact, ChatResult, Item, Message, ModelError, TaskType

RETRYABLE = {408, 409, 425, 429, 500, 502, 503, 504}


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


class LocalState:
    """私有中间结果（ctx.keep / recall），存在本地的 SQLite 文件里。"""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.execute(
            "create table if not exists state (task text, site text, round int, key text, item text, value text, primary key (task, site, round, key, item))"
        )
        self._lock = threading.Lock()

    def get(self, task: str, site: str, round: int, key: str, item: str | None) -> Any:
        with self._lock:
            row = self._db.execute(
                "select value from state where task=? and site=? and round=? and key=? and item=?", (task, site, round, key, item or "")
            ).fetchone()
        return None if row is None else json.loads(row[0])

    def put(self, task: str, site: str, round: int, key: str, item: str | None, value: Any) -> None:
        with self._lock, self._db:
            self._db.execute(
                "insert or replace into state values (?, ?, ?, ?, ?, ?)", (task, site, round, key, item or "", json.dumps(value, ensure_ascii=False))
            )


class ClientStepIO:
    def __init__(
        self,
        state: LocalState,
        task_id: str,
        site_id: str,
        records: dict[str, dict[str, Any]],
        task_type: TaskType,
        labels: bool,
        inbox: dict[str, list[Message]],
        artifact: Artifact | None,
    ) -> None:
        self.state = state
        self.task_id = task_id
        self.site_id = site_id
        self.records = records
        self.task_type = task_type
        self.labels = labels
        self._inbox = inbox
        self._artifact = artifact

    def recall(self, key: str, item_id: str | None, round: int) -> Any:
        return self.state.get(self.task_id, self.site_id, round, key, item_id)

    def inbox(self, channel: str, round: int) -> list[Message]:
        return list(self._inbox.get(channel, []))

    def artifact(self, before_round: int) -> Artifact | None:
        return self._artifact

    def items(self) -> list[Item]:
        out = []
        for item_id, record in self.records.items():
            fields = dict(record) if self.labels else self.task_type.strip_labels(record)
            out.append(Item(id=item_id, fields=fields))
        return out


class LocalModel:
    """参与方自己的模型：OpenAI 兼容接口，密钥从环境变量读，不经过平台。"""

    def __init__(self, base_url: str, model: str, api_key: str | None, *, timeout: float = 600.0, retries: int = 8) -> None:
        self.base_url = base_url.rstrip("/")
        self.name = model
        self.api_key = api_key
        self.timeout = timeout
        self.retries = retries

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
        body: dict[str, Any] = {"model": self.name, "messages": messages, **extra}
        for key, value in (("max_tokens", max_tokens), ("temperature", temperature), ("top_p", top_p)):
            if value is not None:
                body[key] = value
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        last = ""
        with httpx.Client(timeout=self.timeout) as client:
            for attempt in range(self.retries + 1):
                if attempt:
                    time.sleep(min(2 ** (attempt - 1), 30))
                try:
                    response = client.post(f"{self.base_url}/chat/completions", json=body, headers=headers)
                except (httpx.TimeoutException, httpx.TransportError) as error:
                    last = type(error).__name__
                    continue
                if response.status_code in RETRYABLE:
                    last = f"HTTP {response.status_code}"
                    continue
                if response.status_code >= 400:
                    raise ModelError(f"本地模型返回 {response.status_code}")
                data = response.json()
                choice = data["choices"][0]
                usage = data.get("usage") or {}
                return ChatResult(
                    text=str(choice.get("message", {}).get("content") or ""),
                    model=str(data.get("model") or self.name),
                    usage={"prompt_tokens": int(usage.get("prompt_tokens") or 0), "completion_tokens": int(usage.get("completion_tokens") or 0)},
                    finish_reason=choice.get("finish_reason"),
                )
        raise ModelError(f"本地模型重试 {self.retries} 次后仍失败（{last}）")


class FakeModel:
    """测试用：不调用模型，用插件给的格式正确的假回答。"""

    def __init__(self, plugin: Algorithm, step_id: str) -> None:
        self.plugin = plugin
        self.step_id = step_id
        self.name = "fake"

    def chat(self, prompt: str | list[dict[str, Any]], **_: Any) -> ChatResult:
        text = prompt if isinstance(prompt, str) else "\n\n".join(str(message.get("content", "")) for message in prompt)
        digest = hashlib.sha256(text.encode()).hexdigest()
        reply = self.plugin.fake_reply(self.step_id, text, digest) or f"（假模型的回答 {digest[:8]}）"
        return ChatResult(text=reply, model="fake", usage={"prompt_tokens": len(text) // 4, "completion_tokens": len(reply) // 4})
