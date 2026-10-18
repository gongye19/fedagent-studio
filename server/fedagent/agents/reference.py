"""保留联调命令的稳定入口；医疗资源使用 medical-serve。"""
from pathlib import Path

from ..platform import Platform
from .service import create_agent_app


def create_reference_app(platform: Platform, root: Path, model_ref: str, *, token: str | None = None):
    return create_agent_app(platform, root, model_ref, token=token, name="FedAgent reference Agent")
