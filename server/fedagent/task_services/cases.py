"""评测案例仅使用已保存的最终预测和判分；不推断内部决策的因果。"""
import json
import re
from collections import Counter, defaultdict
from contextlib import suppress
from typing import Any

from fedagent_sdk import SERVER, Manifest
from sqlalchemy import select

from .. import models as m
from ..schemas.cases import CaseComparisonOut, CaseComparisonPageOut, CaseOut, CasePageOut
from .data_visibility import protected_sites

CASE_REPORT = "case_result"


def display_text(value: Any) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    text = re.sub(r"<(think|analysis|reasoning)\b[^>]*>.*?(?:</\1>|$)", "", text, flags=re.I | re.S)
    text = text.strip()
    return text[:20000] + ("\n…（内容已截断）" if len(text) > 20000 else "")


def snapshot(task_type, record, item_id, prediction, labeled, correct) -> dict:
    references = []
    for path in task_type.label_fields:
        value = record
        for part in path.split("."):
            value = value.get(part) if isinstance(value, dict) else None
        if value is not None:
            references.append(display_text(value))
    fields = []
    with suppress(AttributeError, KeyError, TypeError, ValueError, NotImplementedError):
        fields = [{"label": display_text(f["label"]), "text": display_text(f["text"])}
                  for f in task_type.preview(task_type.strip_labels(record)) if f.get("text")]
    try:
        input_text = display_text(task_type.input_of(task_type.strip_labels(record)))
    except (KeyError, TypeError, ValueError, NotImplementedError):
        input_text = None
    return {"itemId": item_id, "input": input_text if not fields else None, "fields": fields,
            "prediction": display_text(prediction), "reference": "\n".join(references) or None,
            "outcome": "unlabeled" if not labeled else "passed" if correct else "incorrect"}


def recorded_cases(platform, session, task, *, round=None, site=None) -> list[CaseOut]:
    algorithm = platform.registry.algorithms.get(task.algorithm)
    frozen = task.audit.get("manifest")
    manifest = Manifest.model_validate(frozen) if frozen else algorithm.manifest_for_version(task.plugin_version) if algorithm else None
    evaluation = manifest.evaluation if manifest else None
    if not evaluation:
        return []
    query = select(m.Report).where(m.Report.task_id == task.id, m.Report.step == evaluation.step,
                                   m.Report.name.in_((CASE_REPORT, "correct", "labeled")))
    units_query = select(m.WorkUnit).where(m.WorkUnit.task_id == task.id)
    if round is not None:
        query = query.where(m.Report.round == round)
        units_query = units_query.where(m.WorkUnit.round == round)
    if site:
        query = query.where(m.Report.site_id == site)
        units_query = units_query.where(m.WorkUnit.site_id == site)
    groups = defaultdict(list)
    for report in session.scalars(query.order_by(m.Report.id)):
        groups[(report.round, report.site_id, report.unit_key)].append(report)
    cases = []
    for (r, s, key), reports in groups.items():
        saved = [report for report in reports if report.name == CASE_REPORT]
        if saved:
            cases.extend(CaseOut(key=str(report.id), round=r, site=s, step=evaluation.step, **report.value) for report in saved)
        elif key != "_":
            # 历史单样本单元可读原判分，绝不从模型账本重构未保存的回答或重评旧分数。
            grades = {report.name: report.value for report in reports}
            if "correct" in grades and "labeled" in grades:
                cases.append(CaseOut(key=f"old:{r}:{s}:{key}", round=r, site=s, item_id=key, step=evaluation.step,
                                     outcome="unlabeled" if not grades["labeled"] else "passed" if grades["correct"] else "incorrect"))
    for unit in session.scalars(units_query.where(m.WorkUnit.status == "failed")):
        cases.append(CaseOut(key=f"failed:{unit.id}", round=unit.round, site=unit.site_id, item_id=unit.unit_key,
                             step=unit.step, outcome="error", error=display_text((unit.error or "执行失败").splitlines()[0])[:500]))
    cases.sort(key=lambda c: (c.round, c.site, c.item_id, c.key))
    aliases = {row.id: {str(item): index for index, item in enumerate(row.items, 1)}
               for row in session.scalars(protected_sites(task.id))}
    if not aliases:
        return cases
    public_cases = []
    for case in cases:
        if case.site not in aliases and case.site != SERVER:
            public_cases.append(case)
            continue
        site_aliases = aliases.setdefault(case.site, {})
        item_id = "_" if case.item_id == "_" else f"样本 {site_aliases.setdefault(case.item_id, len(site_aliases) + 1)}"
        key = case.key if not case.key.startswith("old:") else f"protected:{case.round}:{case.site}:{case.step}:{item_id}"
        public_cases.append(CaseOut(key=key, round=case.round, site=case.site, step=case.step,
                                    outcome=case.outcome, item_id=item_id))
    return public_cases


def page(platform, session, task, *, round=None, site=None, outcome=None, offset=0, limit=20) -> CasePageOut:
    cases = recorded_cases(platform, session, task, round=round, site=site)
    counts = dict(Counter(case.outcome for case in cases))
    filtered = [case for case in cases if not outcome or case.outcome == outcome]
    return CasePageOut(items=filtered[offset:offset + limit], total=len(filtered), counts=counts, has_more=offset + limit < len(filtered))


def comparisons(platform, session, task, *, offset=0, limit=20) -> CaseComparisonPageOut:
    groups = defaultdict(list)
    for case in recorded_cases(platform, session, task):
        # 整批执行错误没有病例ID，按实际失败步骤单独呈现，不能冒充病例回答。
        groups[(case.site, case.item_id, case.step if case.item_id == "_" else "")].append(case)
    items = [CaseComparisonOut(key=json.dumps(key), site=key[0], item_id=key[1], cases=values)
             for key, values in sorted(groups.items())]
    return CaseComparisonPageOut(items=items[offset:offset + limit], total=len(items), has_more=offset + limit < len(items))
