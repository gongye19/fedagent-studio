"""接入方的 EvoMedClaw 医疗 Agent 服务；平台只通过 HTTP 调用它。"""
import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from fedagent_evomed.bridge import diagnose
from fedagent_evomed.medical import MedicalDiagnosis
from fedagent_evomed.vendor.runtime.department_first.core.types import MemoryEntry
from fedagent_sdk import Artifact, ModelError
from pydantic import Field, TypeAdapter, ValidationError

from .. import models as m
from ..gateway import LedgerKey
from ..platform import Platform
from ..settings import Settings
from .protocol import Wire
from .service import create_agent_app
from .store import AgentStore


class ExperienceIn(Wire):
    task_id: str = Field(min_length=1, max_length=100)
    site_id: str = Field(min_length=1, max_length=100)
    artifact: Artifact


class DiagnosisIn(Wire):
    case: dict[str, Any]
    task_id: str = Field(min_length=1, max_length=100)
    site_id: str = Field(min_length=1, max_length=100)
    turns: int = Field(default=12, ge=4, le=12)
    use_experience: bool = True


def validate_memory(artifact: Artifact) -> None:
    if artifact.kind != "clinical-memory" or not isinstance(artifact.content, dict):
        raise ValueError("需要医疗经验库")
    memory = artifact.content.get("memory")
    if not isinstance(memory, dict) or not isinstance(memory.get("entries"), list):
        raise ValueError("医疗经验库缺少 memory.entries")
    try:
        TypeAdapter(list[MemoryEntry]).validate_python(memory["entries"])
    except ValidationError as error:
        raise ValueError("医疗经验条目的字段不符合当前 Agent 规范") from error


def create_medical_app(platform: Platform, root: Path, model_ref: str, *, name: str = "医疗 Agent", token: str | None = None):
    algorithm = platform.registry.algorithm("evomedclaw")
    app = create_agent_app(platform, root, model_ref, token=token, algorithm_ids=frozenset({algorithm.id}), name=name)
    store = AgentStore(root)

    @app.post("/experience")
    def experience(body: ExperienceIn):
        try:
            validate_memory(body.artifact)
            store.save_memory(body.task_id, body.site_id, body.artifact)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        return {"version": body.artifact.version, "round": body.artifact.round}

    @app.post("/diagnose")
    def diagnosis(body: DiagnosisIn):
        try:
            case = MedicalDiagnosis().strip_labels(MedicalDiagnosis().application_item(body.case))
            artifact = store.memory(body.task_id, body.site_id) if body.use_experience else None
            memory = artifact.content["memory"] if artifact else None
            model = platform.gateway.model(model_ref, purpose="agent-invoke", plugin=algorithm, step_id="diagnose",
                ledger=LedgerKey(body.task_id, body.site_id, artifact.round if artifact else 0, "direct-diagnose", uuid.uuid4().hex))
            result, usage = diagnose(case, memory, model, turns=body.turns)
        except ValueError as error:
            raise HTTPException(422, "病例或经验格式不符合医疗 Agent 规范") from error
        except ModelError as error:
            raise HTTPException(502, "医疗 Agent 诊断失败，请检查模型连接或问诊上限") from error
        return {"diagnosis": result["predicted_diagnosis"], "trajectory": result,
                "experience_version": artifact.version if artifact else None, "usage": usage}

    return app


def provider_platform(root: Path, model: str | None) -> tuple[Platform, str]:
    """独立部署模式：接入方自行设置环境变量，凭据不经过平台或命令输出。"""
    model = model or os.environ.get("MEDICAL_LLM_MODEL", "")
    url = os.environ.get("MEDICAL_LLM_BASE_URL", "")
    if not url or not model:
        raise ValueError("请设置 MEDICAL_LLM_BASE_URL 和 MEDICAL_LLM_MODEL，或使用 --platform-model 复用同机已保存的接口")
    platform = Platform.create(Settings(data_dir=root / "provider", database_url=None, secret_key=None,
                                        admin_token=None, fake_endpoint=False))
    with platform.db.session() as session:
        endpoint = session.get(m.Endpoint, "medical")
        if endpoint is None:
            endpoint = m.Endpoint(id="medical", name="医疗 Agent 的模型")
            session.add(endpoint)
        endpoint.base_url = url
        endpoint.models = [model]
        key = os.environ.get("MEDICAL_LLM_API_KEY")
        if key:
            endpoint.api_key_enc = platform.secrets.encrypt(key)
    return platform, f"medical:{model}"
