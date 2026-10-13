"""初始数据：数学基准参与方和数据集、预留的模型接口。

- 8 个平台托管的参与方（参与方 A–H），各持一份数学题库；
  AIME24、AIME25 的题目文件随代码提供（取自 Hugging Face 的 math-ai/aime24、math-ai/aime25，按审计包的编号和字段整理）；
  八份审计文件随代码保存，来源与哈希见 docs/math-data-manifest.json；后续替换通过 import_fot_bundle 完整校验导入；
- 默认 LLM 接口（待配置，OpenAI 兼容）和测试用的假模型。
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from sqlalchemy import func, select

from . import models as m
from .data import parse_jsonl
from .gateway import DEFAULT_ENDPOINT, FAKE_ENDPOINT
from .platform import Platform

BUILTIN_DIR = Path(__file__).parent / "builtin" / "math"

BUILTIN = [
    ("aime24", "AIME24", "美国数学邀请赛", "AIME 2024", 30),
    ("aime25", "AIME25", "美国数学邀请赛", "AIME 2025", 30),
    ("amc", "AMC", "美国数学竞赛", "LiveMathBench 202412", 46),
    ("ccee", "CCEE", "中国高考数学", "LiveMathBench 202412", 44),
    ("cnmo", "CNMO", "中国数学奥林匹克", "LiveMathBench 202412", 18),
    ("wlpmc", "WLPMC", "普特南数学竞赛", "LiveMathBench 202412", 11),
    ("v202412hard", "V202412Hard", "竞赛难题", "LiveMathBench 202412", 21),
    ("v202505hard", "V202505Hard", "竞赛难题", "LiveMathBench 202505", 100),
]
"""（键、名称、说明、来源、题数），依次分给参与方 A–H。题数和审计包一致，导入时核对。"""

LETTERS = "ABCDEFGH"
TASK_TYPE = "math-reasoning"


def _store(platform: Platform, dataset: m.Dataset, rows: list[dict], origin: str | None = None) -> None:
    task_type = platform.registry.task_type(TASK_TYPE)
    report = task_type.check(parse_jsonl("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)))
    if not report.ok:
        problems = "；".join(f"第 {issue.line} 行：{issue.message}" for issue in report.issues)
        raise ValueError(f"{dataset.name} 的题目文件检查不通过：{problems}")
    path, digest = platform.files.save(dataset.id, report.items)
    dataset.content_path = path
    dataset.content_hash = digest
    dataset.count = report.count
    dataset.answered = report.answered
    dataset.sample = report.sample
    if origin:
        dataset.origin = origin


def sync_fake_endpoint(platform: Platform) -> None:
    """测试用假模型接口按配置开关同步：开启时补上，关闭时删掉（部署的平台上只留真实接口）。"""
    with platform.db.session() as session:
        row = session.get(m.Endpoint, FAKE_ENDPOINT)
        if platform.settings.fake_endpoint and row is None:
            session.add(m.Endpoint(id=FAKE_ENDPOINT, name="测试用假模型", kind="fake", models=["fake"], concurrency=16, builtin=True, resource_space="public"))
        elif not platform.settings.fake_endpoint and row is not None:
            session.delete(row)


def seed(platform: Platform) -> bool:
    """数据库是空的才写入初始数据；返回是否写入了。测试用假模型接口每次都按配置同步。"""
    sync_fake_endpoint(platform)
    with platform.db.session() as session:
        if session.scalar(select(func.count()).select_from(m.Participant)):
            return False
        for index, (key, name, description, origin, _count) in enumerate(BUILTIN):
            participant = m.Participant(id=f"p-{LETTERS[index].lower()}", name=f"参与方 {LETTERS[index]}", org="平台托管", hosting="platform", builtin=True)
            session.add(participant)
            session.flush()  # 先写参与方，数据集的外键才有效
            dataset = m.Dataset(
                id=f"ds-{key}",
                participant_id=participant.id,
                name=name,
                description=description,
                origin=origin,
                scenario="horizontal",
                task_type=TASK_TYPE,
                source="builtin", resource_space="public",
                count=0,
                answered=0,
            )
            session.add(dataset)
            file = BUILTIN_DIR / f"{name}.jsonl"
            if file.exists():
                rows = [json.loads(line) for line in file.read_text(encoding="utf-8").splitlines() if line.strip()]
                _store(platform, dataset, rows)
        session.add(m.Endpoint(id=DEFAULT_ENDPOINT, name="默认 LLM 接口", kind="openai", builtin=True, resource_space="public"))
    return True


def import_fot_bundle(platform: Platform, bundle: Path) -> list[str]:
    """从 FoT 代码包（FoT_code_bundle_*.zip 或解压后的目录）导入 8 份审计过的数学题库，题数要和审计包一致。"""
    files: dict[str, bytes] = {}
    if bundle.is_dir():
        for path in bundle.rglob("audited_math_reproduction/data/*.jsonl"):
            files[path.stem] = path.read_bytes()
    else:
        with zipfile.ZipFile(bundle) as archive:
            for info in archive.infolist():
                parts = Path(info.filename).parts
                if len(parts) >= 3 and parts[-2] == "data" and "audited_math_reproduction" in parts and info.filename.endswith(".jsonl"):
                    files[Path(info.filename).stem] = archive.read(info)
    missing = [name for _key, name, *_ in BUILTIN if name not in files]
    if missing:
        raise ValueError("缺少题库文件：" + "、".join(missing) + "；没有导入任何数据")
    prepared: dict[str, list[dict]] = {}
    task_type = platform.registry.task_type(TASK_TYPE)
    for _key, name, _description, _origin, count in BUILTIN:
        rows = [json.loads(line) for line in io.StringIO(files[name].decode("utf-8")) if line.strip()]
        if len(rows) != count:
            raise ValueError(f"{name}：包里有 {len(rows)} 题，审计包应为 {count} 题")
        report = task_type.check(parse_jsonl("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)))
        if not report.ok:
            raise ValueError(f"{name} 的题目文件检查不通过；没有导入任何数据")
        prepared[name] = report.items
    imported = []
    with platform.db.session() as session:
        for key, name, _description, _origin, _count in BUILTIN:
            if session.get(m.Dataset, f"ds-{key}") is None:
                raise ValueError(f"内置数据集 {name} 不存在，先初始化数据库")
        for key, name, _description, _origin, _count in BUILTIN:
            dataset = session.get(m.Dataset, f"ds-{key}")
            assert dataset is not None
            _store(platform, dataset, prepared[name])
            imported.append(name)
    return imported


def remove_legacy_demo(platform: Platform) -> dict[str, list[str]]:
    """清理旧版空合作方和机构文案；不删除任务、应用或用户登记的资源。"""
    changed: list[str] = []
    removed: list[str] = []
    with platform.db.session() as session:
        local = session.get(m.Participant, "p-local-example")
        if local is not None:
            if not (local.name == "示例合作方" and local.org == "示例机构" and local.hosting == "local" and local.builtin):
                raise ValueError("原合作方记录已修改，不能按初始占位资源清理")
            datasets = list(session.scalars(select(m.Dataset).where(m.Dataset.participant_id == local.id)))
            if any(dataset.id != "ds-local-example" or dataset.content_hash or dataset.item_ids for dataset in datasets):
                raise ValueError("原合作方已有实际数据，不能按空占位资源清理")
            if session.scalar(select(func.count()).select_from(m.TaskSite).where(m.TaskSite.participant_id == local.id)):
                raise ValueError("原合作方已参加任务，请先处理相关任务")
            session.delete(local)
            removed.extend([dataset.id for dataset in datasets] + [local.id])
        for letter in LETTERS:
            participant = session.get(m.Participant, f"p-{letter.lower()}")
            if participant and participant.builtin and participant.hosting == "platform" and participant.org == "内置示例":
                participant.org = "平台托管"
                changed.append(participant.id)
        # 样本预览必须来自实际文件，不保留旧的手写占位内容。
        for key, _name, _description, _origin, _count in BUILTIN:
            dataset = session.get(m.Dataset, f"ds-{key}")
            if dataset and dataset.source == "builtin":
                if dataset.content_path and dataset.content_hash:
                    rows = platform.files.load(dataset.content_path)
                    report = platform.registry.task_type(TASK_TYPE).check(parse_jsonl("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)))
                    if not report.ok:
                        raise ValueError(f"{dataset.name} 的现有文件不通过校验，未清理")
                    dataset.sample = report.sample
                    dataset.count, dataset.answered = report.count, report.answered
                else:
                    dataset.sample = None
                    dataset.count, dataset.answered = 0, 0
    return {"updated": changed, "removed": removed}
