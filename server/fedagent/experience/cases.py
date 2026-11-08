"""按来源选取独立病例，冻结模型可见输入和仅评分端可见的参考诊断。"""
import re
import unicodedata
from typing import Any

from fedagent_evomed.medical import MedicalDiagnosis, normalize_case
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from ..data import parse_jsonl
from ..errors import ServiceError
from ..platform import Platform
from ..resource_services.verification import digest
from ..schemas.experience import EvaluationSource

CASE_TYPE = MedicalDiagnosis()


def _normalized(value: Any):
    if isinstance(value, str):
        return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value)).strip().casefold()
    if isinstance(value, dict):
        return {key: _normalized(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalized(item) for item in value]
    return value


def case_fingerprint(case: dict) -> str:
    clean = CASE_TYPE.strip_labels(case)
    return digest(_normalized({key: clean.get(key, {}) for key in ("patient", "examination", "tests")}))


def source_sites(session: Session, task_id: str) -> list[m.TaskSite]:
    return list(session.scalars(select(m.TaskSite).where(
        m.TaskSite.task_id == task_id, m.TaskSite.kind == "participant",
    ).order_by(m.TaskSite.ordinal)))


def training_records(platform: Platform, sites: list[m.TaskSite]) -> list[dict]:
    result = []
    for site in sites:
        if site.executor != "platform" or not site.dataset_id or not site.dataset_hash:
            raise ServiceError(409, "缺少已冻结的问诊记录，无法验证评测病例独立性")
        try:
            rows = platform.files.load(f"{site.dataset_id}/{site.dataset_hash}.jsonl")
            items = set(site.items)
            records = [row for row in rows if row["id"] in items]
            if len(records) != len(items):
                raise ValueError("冻结记录缺失")
            result.extend(records)
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise ServiceError(409, "冻结的训练记录无法读取，不能确认病例独立性") from error
    return result


def _training_cases(platform: Platform, sites: list[m.TaskSite]) -> tuple[set[str], set[str]]:
    try:
        records = training_records(platform, sites)
        return ({str(record["id"]).strip().casefold() for record in records},
                {case_fingerprint(record["input"]) for record in records})
    except (KeyError, TypeError) as error:
        raise ServiceError(409, "冻结的训练记录无法读取，不能确认病例独立性") from error


def _source_cases(platform: Platform, session: Session, source: EvaluationSource) -> list[dict]:
    if source.dataset_id:
        row = session.get(m.Dataset, source.dataset_id)
        if row is None or row.task_type != "medical-diagnosis" or not row.content_path or (row.resource_space != "workspace" and not row.shared):
            raise ServiceError(422, "请选择可用的医疗病例数据")
        try:
            rows = platform.files.load(row.content_path)
        except (ValueError, OSError) as error:
            raise ServiceError(422, f"无法读取「{row.name}」的病例") from error
        return [case for case in rows if case.get("split") == "eval" and case.get("answer")][:source.limit]

    cases = []
    for item in parse_jsonl(source.jsonl or ""):
        if item.error or item.data is None:
            raise ServiceError(422, f"病例文件第 {item.line} 行：{item.error or '缺少病例对象'}")
        try:
            case = normalize_case(item.data)
        except ValueError as error:
            raise ServiceError(422, f"病例文件第 {item.line} 行：{error}") from error
        if not case.get("answer") or case.get("split") == "learn":
            raise ServiceError(422, f"病例文件第 {item.line} 行需有参考诊断，且应属于独立评测")
        cases.append(case)
        if len(cases) > 50:
            raise ServiceError(422, "每个来源最多上传 50 条评测病例")
    return cases


def freeze_cases(platform: Platform, session: Session, task_id: str, sources: list[EvaluationSource]) -> list[dict]:
    sites = source_sites(session, task_id)
    choices = {source.site_id: source for source in sources}
    if set(choices) != {site.id for site in sites} or len(choices) != len(sources):
        raise ServiceError(422, "请为任务的每个来源各选一组独立病例")
    train_ids, train_fingerprints = _training_cases(platform, sites)
    seen: set[str] = set()
    result = []
    for site in sites:
        rows = _source_cases(platform, session, choices[site.id])
        if not rows:
            raise ServiceError(422, f"「{site.participant_name}」没有可用的带标注评测病例")
        site_ids: set[str] = set()
        for index, row in enumerate(rows, 1):
            case_id = str(row["id"])
            fingerprint = case_fingerprint(row)
            normalized_id = case_id.strip().casefold()
            if normalized_id in train_ids or fingerprint in train_fingerprints:
                raise ServiceError(422, f"第 {index} 条病例与生成经验用的记录重合，请换用留出病例")
            if normalized_id in site_ids or fingerprint in seen:
                raise ServiceError(422, f"第 {index} 条评测病例重复，请为各来源选择不同病例")
            site_ids.add(normalized_id)
            seen.add(fingerprint)
            evidence = CASE_TYPE.strip_labels(row)
            evidence.pop("split", None)
            if len(str(evidence)) > 40000:
                raise ServiceError(422, f"第 {index} 条病例内容过长")
            result.append({"site_id": site.id, "site_name": site.participant_name, "case_id": case_id,
                           "input": evidence, "reference": row["answer"]})
    if len(result) > 100:
        raise ServiceError(422, "一次最多评测 100 条病例，请减少各来源的数量")
    return result


def redact_reference(value: Any, pattern: re.Pattern[str]) -> Any:
    if isinstance(value, dict):
        return {key: redact_reference(child, pattern) for key, child in value.items()}
    if isinstance(value, list):
        return [redact_reference(child, pattern) for child in value]
    return pattern.sub("[redacted]", value) if isinstance(value, str) else value


def freeze_package_cases(platform: Platform, session: Session, task_id: str,
                         dataset_ids: list[str] | None, limit: int | None) -> list[dict]:
    if dataset_ids is not None and len(set(dataset_ids)) != len(dataset_ids):
        raise ServiceError(422, "请选择两份不同的问诊数据")
    sites = source_sites(session, task_id)
    if not sites:
        raise ServiceError(409, "缺少经验包的来源数据，无法识别回测病例")
    train_ids, train_fingerprints = _training_cases(platform, sites)
    if dataset_ids is None:
        sources = [(site.dataset_id, site.dataset_hash) for site in sites]
    else:
        # 兼容显式选择数据集的评测请求。
        sources = [(dataset_id, None) for dataset_id in dataset_ids]
        limit = limit or 100
    seen: set[str] = set()
    result = []
    for dataset_id, frozen_hash in sources:
        dataset = session.get(m.Dataset, dataset_id)
        if (dataset is None or dataset.task_type != "medical-records" or not dataset.content_path
                or (dataset.resource_space != "workspace" and not dataset.shared)):
            raise ServiceError(422, "评测所需的医疗问诊数据已不可用")
        content_path = f"{dataset.id}/{frozen_hash}.jsonl" if frozen_hash else dataset.content_path
        try:
            rows = [(ordinal, row) for ordinal, row in enumerate(platform.files.load(content_path), 1)
                    if row.get("answer")][:limit]
        except (ValueError, OSError) as error:
            raise ServiceError(422, f"无法读取「{dataset.name}」的病例") from error
        if not rows:
            raise ServiceError(422, f"「{dataset.name}」没有可评测病例")
        for ordinal, row in rows:
            reference, evidence, identifier = row.get("answer"), row.get("input"), row.get("id")
            if not identifier or not isinstance(reference, str) or not reference.strip() or not isinstance(evidence, dict):
                raise ServiceError(422, f"「{dataset.name}」第 {ordinal} 例缺少有效病例或参考诊断")
            fingerprint = case_fingerprint(evidence)
            if fingerprint in seen:
                raise ServiceError(422, f"「{dataset.name}」第 {ordinal} 例与已选病例重复")
            seen.add(fingerprint)
            reused = str(identifier).strip().casefold() in train_ids or fingerprint in train_fingerprints
            clean = CASE_TYPE.strip_labels({key: evidence[key] for key in ("patient", "objective", "examination", "tests")
                                             if key in evidence})
            if len(str(clean)) > 40000:
                raise ServiceError(422, f"「{dataset.name}」第 {ordinal} 例病例内容过长")
            # 病史原文中偶尔直接写有参考诊断，两组都遮掉字面答案。
            phrase = r"\s+".join(map(re.escape, reference.split()))
            pattern = re.compile(rf"(?<!\w){phrase}(?!\w)", re.IGNORECASE)
            result.append({"site_id": dataset.id, "site_name": dataset.name, "ordinal": ordinal,
                           "usage": "backtest" if reused else "heldout", "data_hash": frozen_hash or dataset.content_hash,
                           "input": redact_reference(clean, pattern), "reference": reference})
    return result
