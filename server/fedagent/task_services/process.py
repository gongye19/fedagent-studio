"""通用过程记录：按运行编号和事件序号去重，独立于算法结果与判分。"""
from fedagent_sdk import ProgressUpdate
from sqlalchemy import select

from .. import models as m
from ..schemas.process import ProcessEventOut, ProcessPageOut


def last_sequence(platform, task_id: str, origin: str) -> int:
    with platform.db.session() as session:
        row = session.scalars(select(m.Event).where(m.Event.task_id == task_id, m.Event.kind == "process",
                              m.Event.data["origin"].as_string() == origin).order_by(m.Event.id.desc()).limit(1)).first()
        return int((row.data or {}).get("seq", 0)) if row else 0


def append(platform, *, task_id: str, origin: str, seq: int, site: str, round: int, step: str, unit: str,
           event: ProgressUpdate, at=None) -> None:
    with platform.db.session() as session:
        if session.get(m.Task, task_id) is None:
            return
        session.add(m.Event(task_id=task_id, kind="process", message=event.title, created_at=at or m.now(), data={
            "origin": origin, "seq": seq, "site": site, "round": round, "step": step, "unit": unit,
            "event": event.model_dump(mode="json"),
        }))


def page(session, task_id: str, *, after: int = 0, round: int | None = None, site: str | None = None, limit: int = 100) -> ProcessPageOut:
    query = select(m.Event).where(m.Event.task_id == task_id, m.Event.kind == "process", m.Event.id > after)
    if round is not None:
        query = query.where(m.Event.data["round"].as_integer() == round)
    if site is not None:
        query = query.where(m.Event.data["site"].as_string() == site)
    rows = session.scalars(query.order_by(m.Event.id).limit(limit + 1)).all()
    runs = {r.id: r.status for r in session.scalars(select(m.AgentRun).where(m.AgentRun.task_id == task_id))}
    units = {f"unit-{u.id}": (u.attempts, u.status) for u in session.scalars(select(m.WorkUnit).where(m.WorkUnit.task_id == task_id))}
    origins = session.scalars(select(m.Event.data["origin"].as_string()).where(
        m.Event.task_id == task_id, m.Event.kind == "process").distinct())
    states = dict(runs)
    for origin in origins:
        if "-attempt-" in origin:
            key, attempt = origin.rsplit("-attempt-", 1)
            current = units.get(key)
            if current:
                states[origin] = current[1] if str(current[0]) == attempt else "superseded"
    events = []
    for row in rows[:limit]:
        data = row.data or {}
        events.append(ProcessEventOut(id=row.id, origin=data["origin"], site=data["site"], round=data["round"],
                                      step=data["step"], unit=data["unit"], at=row.created_at, event=data["event"]))
    return ProcessPageOut(events=events, after=events[-1].id if events else after, has_more=len(rows) > limit, states=states)
