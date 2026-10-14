from __future__ import annotations

from fastapi import Response
from sqlalchemy import select

from .. import apps
from .. import models as m
from ..schemas import AppIn, ApplyIn, ApplyOut, ApplySide, AppOut, AppPatch
from .dependencies import PlatformDep, SessionDep, admin_router

router = admin_router()


@router.get("/apps", response_model=list[AppOut], tags=["apps"])
def list_apps(platform: PlatformDep, session: SessionDep) -> list[AppOut]:
    rows = session.scalars(select(m.App).order_by(m.App.published_at.desc()))
    return [apps.app_out(platform, row) for row in rows]


@router.post("/apps", response_model=AppOut, status_code=201, tags=["apps"])
def publish_app(body: AppIn, platform: PlatformDep, session: SessionDep) -> AppOut:
    app = apps.publish(platform, session, body)
    session.flush()
    return apps.app_out(platform, app)


@router.get("/apps/{app_id}", response_model=AppOut, tags=["apps"])
def get_app(app_id: str, platform: PlatformDep, session: SessionDep) -> AppOut:
    return apps.app_out(platform, apps.get_app(session, app_id))


@router.patch("/apps/{app_id}", response_model=AppOut, tags=["apps"])
def rename_app(app_id: str, body: AppPatch, platform: PlatformDep, session: SessionDep) -> AppOut:
    app = apps.get_app(session, app_id)
    app.name = body.name.strip()
    return apps.app_out(platform, app)


@router.delete("/apps/{app_id}", status_code=204, tags=["apps"])
def withdraw_app(app_id: str, session: SessionDep) -> Response:
    session.delete(apps.get_app(session, app_id))
    return Response(status_code=204)


@router.post("/apps/{app_id}/apply", response_model=ApplyOut, tags=["apps"])
def apply_app(app_id: str, body: ApplyIn, platform: PlatformDep, session: SessionDep) -> ApplyOut:
    app = apps.get_app(session, app_id)
    session.expunge(app)
    return apps.apply(platform, app, body)


@router.post("/apps/{app_id}/invoke", response_model=ApplySide, tags=["apps"])
def invoke_app(app_id: str, body: ApplyIn, platform: PlatformDep, session: SessionDep) -> ApplySide:
    app = apps.get_app(session, app_id)
    session.expunge(app)
    return apps.invoke(platform, app, body)


@router.get("/apps/{app_id}/export", tags=["apps"])
def export_app(app_id: str, platform: PlatformDep, session: SessionDep) -> Response:
    filename, media_type, body = apps.export(platform, apps.get_app(session, app_id))
    return Response(content=body, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})
