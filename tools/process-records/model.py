"""本地生成工具使用平台模型通道，不读取提供者密钥；成功调用按请求哈希缓存。"""
import hashlib
import json
import os
from pathlib import Path

import httpx
from fedagent_sdk import ChatResult


class PlatformModel:
    def __init__(self, url: str, ref: str, cache: Path):
        self.name = ref
        self.url = url.rstrip('/')
        self.cache = cache
        cache.mkdir(parents=True, exist_ok=True)
        self.usage: dict[str, int] = {}

    def chat(self, prompt, **kwargs):
        messages = [{'role': 'user', 'content': prompt}] if isinstance(prompt, str) else prompt
        body = {'model': self.name, 'messages': messages}
        key = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
        target = self.cache / (key + '.json')
        if target.exists():
            result = json.loads(target.read_text())
        else:
            token = os.environ.get('FEDAGENT_TOKEN')
            headers = {'Authorization': 'Bearer ' + token} if token else {}
            response = httpx.post(self.url + '/v1/record-generation/chat', json=body, headers=headers, timeout=240)
            response.raise_for_status()
            result = response.json()
            if not result['text'].strip():
                raise ValueError('模型没有返回内容')
            temp = target.with_suffix('.tmp')
            temp.write_text(json.dumps(result, ensure_ascii=False))
            temp.replace(target)
        for key, value in result.get('usage', {}).items():
            self.usage[key] = self.usage.get(key, 0) + value
        return ChatResult(result['text'], self.name, result.get('usage', {}))
