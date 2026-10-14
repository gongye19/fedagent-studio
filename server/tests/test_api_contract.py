"""模块重组不能让浏览器的已生成接口契约失效。"""

import json
from pathlib import Path

import pytest

from fedagent.api import create_app
from fedagent.platform import Platform


def test_generated_frontend_contract_matches_backend(platform: Platform):
    frontend = Path(__file__).resolve().parents[2] / "app"
    if not frontend.is_dir():
        pytest.skip("独立后端部署不包含前端源码；完整仓库执行跨端契约检查")
    artifact = frontend / "src/api/openapi.json"
    assert create_app(platform).openapi() == json.loads(artifact.read_text())
