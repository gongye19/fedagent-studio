from __future__ import annotations

import hmac
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from ..platform import Platform


def platform_of(request: Request) -> Platform:
    return request.app.state.platform


def db_session(request: Request) -> Iterator[Session]:
    with platform_of(request).db.session() as session:
        yield session


def require_admin(request: Request, authorization: Annotated[str | None, Header()] = None) -> None:
    token = platform_of(request).settings.admin_token
    if not token:
        return
    supplied = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(supplied, token):
        raise HTTPException(401, "需要访问令牌")


PlatformDep = Annotated[Platform, Depends(platform_of)]


SessionDep = Annotated[Session, Depends(db_session, scope="function")]


def admin_router() -> APIRouter:
    return APIRouter(prefix="/v1", dependencies=[Depends(require_admin)])
