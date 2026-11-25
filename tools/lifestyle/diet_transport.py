"""仅本轮实验的诊断桥：读取安全的上游错误详情，不修改生产网关或重试模型。"""

import json
import shlex
import subprocess
import time

from fedagent_sdk import ModelError

from .common import digest, save
from .model import CachedModel, InvalidReply
from .sensor_trial.transport import SSHLink

# 保留原GatewayModel请求、流解析和服务端账本。观察钩子只在当前SSH子进程生效。
REMOTE = r"""
import json,re,sys
from pathlib import Path
from dataclasses import replace
from fedagent.db import Database
from fedagent.crypto import SecretBox
from fedagent.gateway import Gateway
from fedagent.settings import Settings
from fedagent_sdk import ModelError
import fedagent.model_runtime as runtime
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
def clean(value):
    text=str(value)
    if endpoint.api_key: text=text.replace(endpoint.api_key,'[redacted]')
    text=re.sub(r'(?i)bearer\s+\S+|sk-[A-Za-z0-9_-]+|(?:api[_-]?key|token|secret)\s*[:=]\s*\S+','[redacted]',text)
    text=re.sub(r'https?://\S+','[url]',text)
    return text[:700]
observed=[]
original=runtime.read_stream
def inspect_stream(lines):
    def observe():
        for line in lines:
            if line.strip().startswith('data:'):
                try: chunk=json.loads(line.strip()[5:].strip())
                except ValueError: chunk=None
                if isinstance(chunk,dict) and chunk.get('error'):
                    error=chunk['error']
                    observed.append({k:clean(error[k]) for k in ('message','type','code','status') if k in error}
                                    if isinstance(error,dict) else {'message':clean(error)})
            yield line
    return original(observe())
runtime.read_stream=inspect_stream
try:
    reply=runtime.GatewayModel(gateway,replace(endpoint,max_retries=0,timeout=600),model,ledger=None,
        purpose='lifestyle-local-preparation',plugin=None,step_id=None).chat(request['messages'],**request['settings'])
except ModelError as error:
    print(json.dumps({'bridgeError':{'message':clean(error),'upstream':observed,
        'completedUpstreamError':bool(observed)}})); sys.exit(0)
print(json.dumps({'text':reply.text,'model':reply.model,'usage':reply.usage,'finish_reason':reply.finish_reason}))
"""
COMMAND = (
    'cd "$HOME/fedagent-studio/server" && FEDAGENT_DATA_DIR="$HOME/fedagent-studio/data" FEDAGENT_FAKE_ENDPOINT=0 .venv/bin/python -c '
    + shlex.quote(REMOTE)
)


class CompletedUpstreamError(InvalidReply):
    completed_upstream_error = True


class DietLink(SSHLink):
    def __init__(self, directory):
        self.directory = directory

    def request(self, request):
        self.check()
        start = time.monotonic()
        try:
            result = subprocess.run(
                self.base + [COMMAND],
                input=json.dumps(request),
                text=True,
                capture_output=True,
                timeout=15 if request.get("inspect") else 660,
                check=True,
            )
            value = json.loads(result.stdout)
        except (subprocess.SubprocessError, ValueError) as error:
            raise ModelError("SSH诊断桥未完整返回；未自动重发：" + type(error).__name__) from error
        if "bridgeError" in value:
            detail = value["bridgeError"]
            save(self.directory / f"upstream-{digest(request)}-{time.time_ns()}.json", detail)
            if detail.get("completedUpstreamError"):
                raise CompletedUpstreamError("已收到上游错误；安全详情已记录，用量未知")
            raise ModelError("模型未成功返回；安全详情已记录，停止自动重试")
        print(f"diet bridge {'inspect' if request.get('inspect') else 'reply'}: {time.monotonic() - start:.1f}s", flush=True)
        return value


class DietCachedModel(CachedModel):
    def __init__(self, *args, link, **kwargs):
        self.link = link
        super().__init__(*args, **kwargs)

    def _request(self, request):
        return self.link.request(request)
