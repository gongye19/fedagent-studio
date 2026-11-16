"""限额、缓存的真实模型桥；远端只读配置并追加正常模型审计，不创建平台资源。"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import threading
from pathlib import Path

from fedagent_sdk import ChatResult, ModelError

from .common import digest, load, save

# 不调用 Platform.create/get_settings，不迁移数据库或生成密钥。不把密钥送回本机。
REMOTE = """
import json,sys
from pathlib import Path
from dataclasses import replace
from fedagent.db import Database
from fedagent.crypto import SecretBox
from fedagent.gateway import Gateway
from fedagent.model_runtime import GatewayModel
from fedagent.settings import Settings
root=Path.home()/'fedagent-studio/data'
for name in ('fedagent.db','secret.key','.model-slots'):
    if not (root/name).exists(): raise RuntimeError('Existing deployment data is required')
request=json.load(sys.stdin)
settings=Settings(data_dir=root,fake_endpoint=False)
gateway=Gateway(Database('sqlite:///'+str(root/'fedagent.db')), SecretBox((root/'secret.key').read_bytes().strip()),
    allowed_hosts=tuple(settings.llm_allowed_hosts))
endpoint,model=gateway.resolve(request['ref'])
identity={'endpoint':endpoint.id,'model':model,'kind':endpoint.kind,'baseUrl':endpoint.base_url}
if endpoint.kind=='fake': raise RuntimeError('Real model required')
if request.get('inspect'):
    print(json.dumps(identity)); sys.exit(0)
if identity!=request['identity']: raise RuntimeError('Model identity changed')
reply=GatewayModel(gateway,replace(endpoint,max_retries=0,timeout=600),model,ledger=None,
    purpose='lifestyle-local-preparation',plugin=None,step_id=None).chat(request['messages'],**request['settings'])
print(json.dumps({'text':reply.text,'model':reply.model,'usage':reply.usage,'finish_reason':reply.finish_reason}))
"""
COMMAND = 'cd "$HOME/fedagent-studio/server" && FEDAGENT_DATA_DIR="$HOME/fedagent-studio/data" FEDAGENT_FAKE_ENDPOINT=0 .venv/bin/python -c ' + shlex.quote(
    REMOTE
)


def remote(request):
    target = os.environ.get("FEDAGENT_LIFESTYLE_SSH_TARGET", "")
    if not target or target.startswith("-"):
        raise ModelError("请设置 FEDAGENT_LIFESTYLE_SSH_TARGET（现有 SSH 配置别名或 user@host）")
    port = os.environ.get("FEDAGENT_LIFESTYLE_SSH_PORT", "22")
    if not port.isdecimal() or not 1 <= int(port) <= 65535:
        raise ModelError("SSH 端口不合法")
    result = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-p", port, target, COMMAND],
        input=json.dumps(request),
        text=True,
        capture_output=True,
        timeout=720,
        check=False,
    )
    if result.returncode:
        # 不输出远端 traceback（可能含部署细节），原始内容也不落盘。
        raise ModelError("远程模型调用失败；请检查现有接口与 SSH 连接，未使用假模型回退")
    value = json.loads(result.stdout)
    return value


class CachedModel:
    def __init__(self, directory: Path, ref: str, limit: int = 50):
        if ":" not in ref:
            raise ValueError("必须提供明确的 接口id:模型名，不能使用 default 简写")
        if not 1 <= limit <= 50:
            raise ValueError("首次小规模试验限额必须在 1–50 次")
        self.directory, self.ref, self.limit = directory, ref, limit
        self.lock = threading.RLock()
        self.last = threading.local()
        self.requests = {}
        self.slots = threading.BoundedSemaphore(2)
        self.identity = remote({"ref": ref, "inspect": True})
        path = directory / "model.json"
        if path.exists() and load(path) != self.identity:
            raise ValueError("模型配置发生变化；请使用新的实验目录")
        save(path, self.identity)
        self.name = self.identity["model"]

    def chat(self, prompt, **settings):
        messages = [{"role": "user", "content": prompt}] if isinstance(prompt, str) else prompt
        body = {"ref": self.ref, "identity": self.identity, "messages": messages, "settings": settings}
        path = self.directory / "calls" / (digest(body) + ".json")
        self.last.path = path
        # 同一请求串行去重，不同请求最多两路；预算与缓存提交各自原子化。
        with self.lock:
            request_lock = self.requests.setdefault(str(path), threading.Lock())
        with request_lock, self.slots:
            with self.lock:
                if path.exists():
                    value = load(path)
                    if value.get("result") and not value.get("rejected"):
                        return ChatResult(**value["result"], cached=True)
                attempts = self.directory / "attempts.json"
                ledger = load(attempts) if attempts.exists() else []
                if len(ledger) >= self.limit:
                    raise ModelError(f"已达到 {self.limit} 次真实调用上限；保留检查点，未完成部分不计分")
                row = {"ordinal": len(ledger) + 1, "requestHash": digest(body), "status": "started"}
                ledger.append(row)
                save(attempts, ledger)
                print(f"model call {len(ledger)}/{self.limit}", flush=True)
            try:
                result = remote(body)
                row["usage"] = result.get("usage", {})
                row["reportedModel"] = result.get("model")
                if not result.get("text", "").strip() or result.get("finish_reason") not in (None, "stop"):
                    raise ModelError("模型返回为空或未完整结束")
                with self.lock:
                    if path.exists() and load(path).get("rejected"):
                        save(self.directory / "rejected" / f"{digest(body)}-{row['ordinal']}.json", load(path))
                    save(path, {"request": body, "result": result})
                row["status"] = "ok"
                return ChatResult(**result)
            except (subprocess.SubprocessError, ValueError, ModelError) as error:
                row["status"] = "error"
                raise ModelError(str(error)) from error
            finally:
                with self.lock:
                    current = load(attempts)
                    current[row["ordinal"] - 1] = row
                    save(attempts, current)

    def reject_last(self):
        """调用方发现语义／格式不合法：保留审计，但不再把该回复作为可重放成功。"""
        path = getattr(self.last, "path", None)
        with self.lock:
            if path is not None and path.exists():
                value = load(path)
                value["rejected"] = True
                save(path, value)
