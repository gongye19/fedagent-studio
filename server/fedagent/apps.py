"""应用：把一版产出发布出来，试用（带产出 / 不带产出对比）、导出、API 调用。

应用复制一份产出内容并记下分类和插件版本，来源任务删掉后仍然可用。怎么使用产出由算法插件的 apply、export 决定。
"""

from __future__ import annotations

from fastapi import HTTPException
from fedagent_sdk import ApplyRequest, Artifact, ModelError
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models as m
from .platform import Platform
from .resources import new_id, not_found
from .schemas import AppIn, ApplyIn, ApplyOut, ApplySide, AppOut, OutputItem
from .tasks import get_task


def artifact_of(app: m.App) -> Artifact:
    return Artifact(version=app.version, round=app.built_after_round, kind=app.kind, content=app.content)


def publish(platform: Platform, session: Session, body: AppIn) -> m.App:
    task = get_task(session, body.task_id)
    row = session.scalars(select(m.Artifact).where(m.Artifact.task_id == task.id, m.Artifact.round == body.built_after_round)).first()
    if row is None:
        raise HTTPException(404, "这一轮还没有产出")
    if session.scalars(select(m.App).where(m.App.task_id == task.id, m.App.version == row.version)).first() is not None:
        raise HTTPException(409, "这一版已经发布过了")
    app = m.App(
        id=new_id("app"),
        task_id=task.id,
        version=row.version,
        built_after_round=row.round,
        name=body.name.strip(),
        scenario=task.scenario,
        task_type=task.task_type,
        algorithm=task.algorithm,
        plugin_version=row.plugin_version,
        kind=row.kind,
        content=row.content,
    )
    session.add(app)
    return app


def app_out(platform: Platform, app: m.App) -> AppOut:
    algorithm = platform.registry.algorithms.get(app.algorithm)
    if algorithm is not None:
        items = [OutputItem(key=entry.key, text=entry.text, category=entry.category) for entry in algorithm.describe(artifact_of(app))]
    elif isinstance(app.content, dict):
        items = [OutputItem(key=str(key), text=str(value)) for key, value in app.content.items()]
    else:
        items = []
    return AppOut(
        id=app.id,
        task_id=app.task_id,
        built_after_round=app.built_after_round,
        name=app.name,
        published_at=app.published_at,
        scenario=app.scenario,
        task_type=app.task_type,
        algorithm=app.algorithm,
        plugin_version=app.plugin_version,
        items=items,
    )


def get_app(session: Session, app_id: str) -> m.App:
    app = session.get(m.App, app_id)
    if app is None:
        raise not_found("应用")
    return app


def apply(platform: Platform, app: m.App, body: ApplyIn) -> ApplyOut:
    """同一个输入分别带产出、不带产出各跑一次；给了答案时按任务类型的默认判分方式打分。"""
    registry = platform.registry
    algorithm = registry.algorithm(app.algorithm)
    task_type = registry.task_type(app.task_type)
    grader = registry.grader(task_type.graders[0])
    request = ApplyRequest(input=body.input.strip(), answer=body.answer)
    sides: dict[str, ApplySide] = {}
    for key, artifact in (("with", artifact_of(app)), ("without", None)):
        try:
            model = platform.gateway.model(body.model, purpose="apply", plugin=algorithm)
            result = algorithm.apply(artifact, request, model)
        except ModelError as error:
            raise HTTPException(502, f"模型调用失败：{error}") from error
        correct = None
        if body.answer and body.answer.strip():
            correct = grader.grade(result.output, {"id": "try", "question": request.input, "answer": body.answer.strip()})
        tokens = int(result.usage.get("prompt_tokens", 0)) + int(result.usage.get("completion_tokens", 0))
        sides[key] = ApplySide(output=result.output, correct=correct, tokens=tokens)
    return ApplyOut.model_validate({"without": sides["without"], "with": sides["with"]})


def export(platform: Platform, app: m.App) -> tuple[str, str, bytes]:
    return platform.registry.algorithm(app.algorithm).export(artifact_of(app))
