"""评测摘要和按需分页，不向界面返回病例正文。"""
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from ..schemas.experience import (
    Arm,
    Change,
    EvaluationArm,
    PackageEvaluationCase,
    PackageEvaluationCasePage,
    PackageEvaluationOut,
    PackageEvaluationResultArm,
    PackageEvaluationSite,
    PackageEvaluationSummary,
)
from . import evaluation, frozen_cases

ARMS: tuple[Arm, ...] = ("none", "federated")
CaseFilter = Literal["all", "changed", "improved", "worsened", "unchanged", "incomplete"]

def summary(job: m.Task) -> PackageEvaluationSummary:
    return PackageEvaluationSummary.model_validate(dict(id=job.id, package_name=job.config["package_name"],
                                                        usage=job.config["usage"], total=job.config["total"],
                                                        status=job.status, created_at=m.aware(job.created_at)))


def list_jobs(session: Session) -> list[PackageEvaluationSummary]:
    rows = session.execute(select(
        m.Task.id, m.Task.config["package_name"].as_string(), m.Task.config["usage"].as_string(),
        m.Task.config["total"].as_integer(), m.Task.status, m.Task.created_at,
    ).where(m.Task.evaluation_package_id.is_not(None)).order_by(m.Task.created_at.desc()))
    return [PackageEvaluationSummary.model_validate(dict(id=id_, package_name=name, usage=usage, total=total,
                                                         status=status, created_at=m.aware(created_at)))
            for id_, name, usage, total, status, created_at in rows]


def present(session: Session, job: m.Task, *, include_cases: bool = True) -> PackageEvaluationOut:
    reports = {(row.site_id, row.unit_key, row.step): row.value for row in evaluation.report_rows(session, job.id)}
    sites: dict[str, PackageEvaluationSite] = {}
    cases = []
    for index, case in enumerate(frozen_cases.index(job)):
        site_id, usage = case["site_id"], case["usage"]
        group = f"{site_id}:{usage}"
        if group not in sites:
            sites[group] = PackageEvaluationSite(id=group, name=case["site_name"], usage=usage)
        site = sites[group]
        arms: dict[Arm, EvaluationArm] = {}
        for arm in ARMS:
            if (stored := reports.get((site_id, str(index), arm))) is not None:
                arms[arm] = EvaluationArm(correct=stored.get("correct"), error="评测未完成" if stored.get("error") else None)
        change = evaluation.count_case(site, arms, ARMS, "none")
        cases.append(PackageEvaluationCase(site_id=group, case_id=f"病例 {case['ordinal']}",
                                           arms={key: PackageEvaluationResultArm(correct=value.correct, error=value.error)
                                                 for key, value in arms.items()}, change=change))
    return PackageEvaluationOut(**summary(job).model_dump(), model=job.config["model"], error=job.error,
                                paired=sum(site.paired for site in sites.values()),
                                scoring_version=job.config.get("scoring_version"),
                                sites=list(sites.values()),
                                changes={key: sum(case.change == key for case in cases)
                                         for key in ("improved", "worsened", "unchanged", "incomplete")},
                                cases=cases if include_cases and job.status not in ("queued", "running") else [])



def case_page(session: Session, job: m.Task, *, site: str | None, change: CaseFilter, offset: int, limit: int) -> PackageEvaluationCasePage:
    result = present(session, job)
    cases = [case for case in result.cases if site is None or case.site_id == site]
    counts: dict[Change, int] = {key: sum(case.change == key for case in cases) for key in ("improved", "worsened", "unchanged", "incomplete")}
    visible = [case for case in cases if change == "all" or case.change == change or
               (change == "changed" and case.change in ("improved", "worsened"))]
    return PackageEvaluationCasePage(cases=visible[offset:offset + limit], total=len(visible), counts=counts)
