from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select

from .. import __version__, resources
from ..schemas import AlgorithmOut, MetaOut, RegistryOut
from .dependencies import PlatformDep, SessionDep, admin_router

public = APIRouter()
router = admin_router()


@public.get("/healthz", include_in_schema=False)
def healthz(session: SessionDep) -> dict[str, bool]:
    session.execute(select(1))
    return {"ok": True}


@public.get("/v1/meta", response_model=MetaOut, tags=["system"])
def meta(platform: PlatformDep) -> MetaOut:
    packages = platform.settings.client_dist
    return MetaOut(
        version=__version__,
        auth_required=bool(platform.settings.admin_token),
        client_packages=sorted(path.name for path in packages.glob("*.whl")) if packages and packages.is_dir() else [],
    )


@router.get("/registry", response_model=RegistryOut, tags=["registry"])
def registry(platform: PlatformDep) -> dict:
    return platform.registry.describe()


@router.get("/algorithms/{algorithm_id}", response_model=AlgorithmOut, tags=["registry"])
def algorithm(algorithm_id: str, platform: PlatformDep) -> dict:
    found = platform.registry.algorithms.get(algorithm_id)
    if found is None:
        raise resources.not_found("算法")
    return platform.registry.describe_algorithm(found)


@router.get("/algorithms/{algorithm_id}/contract", tags=["registry"])
def algorithm_contract(algorithm_id: str, platform: PlatformDep) -> dict:
    """只返回算法声明和数据规范，不含已登记资源、地址或凭据。"""
    from ..agents.protocol import document

    found = platform.registry.algorithms.get(algorithm_id)
    if found is None:
        raise resources.not_found("算法")
    protocol = document(platform.registry)
    return {"algorithm": platform.registry.describe_algorithm(found),
            "manifest": protocol["algorithms"][algorithm_id],
            "resourcesNote": "最少来源数是联邦任务整体要求；单个用户可仅登记一组，与其他方共享资源组合。",
            "dataContracts": {key: value for key, value in protocol["dataContracts"].items() if key in found.manifest.accepts},
            "agentProtocol": {key: protocol[key] for key in ("protocol", "endpoints", "limits", "capabilitiesSchema", "requestSchema", "responseSchema")}
            if found.manifest.agent_supported else None,
            "outputContract": protocol["outputContracts"][algorithm_id],
            "plans": {str(r): found.plan(r, found.manifest.rounds.default) for r in range(1, found.manifest.rounds.default + 1)}}
