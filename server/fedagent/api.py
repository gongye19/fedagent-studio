from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fedagent_sdk import ModelError
from starlette.types import Scope

from . import __version__
from .errors import ServiceError
from .http import agents, apps, checks, client, endpoints, record_generation, resources, sharing, system, tasks
from .platform import Platform


class FrontendFiles(StaticFiles):
    """前端构建产物：带哈希的 assets/ 长期缓存；index.html 每次都向服务端确认，部署新版本后马上生效。"""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
        return response


def create_app(platform: Platform) -> FastAPI:
    from .checks.service import interrupt_checks

    @asynccontextmanager
    async def lifespan(_app):
        interrupt_checks(platform)
        yield

    app = FastAPI(title="FedAgent Studio API", version=__version__, lifespan=lifespan)
    app.state.platform = platform

    @app.exception_handler(ServiceError)
    async def _service_error(_request: Request, error: ServiceError) -> JSONResponse:
        return JSONResponse(status_code=error.status_code, content={"detail": error.detail})

    # 经 Tailscale 中继访问时带宽有限：页面脚本和较大的 JSON 压缩后再发
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    @app.middleware("http")
    async def _api_cache(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/v1/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    routers = (system.public, system.router, resources.router, sharing.router, endpoints.router,
               agents.router, checks.router, tasks.router, apps.router, client.router, record_generation.router)
    for router in routers:
        app.include_router(router)

    @app.exception_handler(ModelError)
    async def _model_error(_request: Request, error: ModelError) -> JSONResponse:
        return JSONResponse(status_code=502, content={"detail": f"模型调用失败：{error}"})

    packages = platform.settings.client_dist
    if packages is not None and packages.is_dir():
        # 安装包里只有代码，不需要令牌；要挂在前端之前，否则会被 "/" 接走
        app.mount("/client", StaticFiles(directory=packages), name="client")
    dist = platform.settings.frontend_dist
    if dist is not None and dist.exists():
        app.mount("/", FrontendFiles(directory=dist, html=True), name="frontend")
    return app
