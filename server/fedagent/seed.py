"""初始数据：内置示例参与方和数据集、预留的模型接口。

- 8 个平台托管的示例参与方（参与方 A–H），各持一份数学题库（和前端的内置示例一致）；
  AIME24、AIME25 的题目文件随代码提供（取自 Hugging Face 的 math-ai/aime24、math-ai/aime25，按审计包的编号和字段整理）；
  其余 6 份来自 LiveMathBench（需要同意使用条款），用 import_fot_bundle 从 FoT 代码包里导入审计过的原始文件；
- 1 个等待连接的本地参与方示例；
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

SAMPLES = {
    "aime24": ("Find the largest possible real part of \\[(75+117i)z+\\frac{96+144i}{z}\\]where $z$ is a complex number with $|z|=4$.", "540"),
    "aime25": ("Find the sum of all integer bases $b>9$ for which $17_b$ is a divisor of $97_b.$", "70"),
    "amc": ("What is $10! - 7! \\cdot 6!$", "0"),
    "ccee": ("The mode of the data $2,3,5,5,4$ is ?", "5"),
    "cnmo": ("What is the minimum value of $y=\\frac{4^x+1}{2^x+1}$?", "2\\sqrt{2}-2"),
    "wlpmc": (
        "For a positive integer $n$, let $f_n(x) = \\cos(x) \\cos(2x) \\cos(3x) \\cdots \\cos(nx)$. Find the smallest $n$ such that $|f_n''(0)| > 2023$.",
        "n=18",
    ),
    "v202412hard": ("Given the data 5, 6, $x$, $x$, 8, 9 with an average of 7, then the 40% percentile of this data set is?", "7"),
    "v202505hard": ("For two numbers $a > b$ from the list $3, 9, 15, 21, 27$, what can you say for certain?", None),
}
"""每份数据集的样本示例（最短的一道题），和前端内置示例一致。"""

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
    if origin:
        dataset.origin = origin


def seed(platform: Platform) -> bool:
    """数据库是空的才写入初始数据；返回是否写入了。"""
    with platform.db.session() as session:
        if session.scalar(select(func.count()).select_from(m.Participant)):
            return False
        for index, (key, name, description, origin, count) in enumerate(BUILTIN):
            participant = m.Participant(id=f"p-{LETTERS[index].lower()}", name=f"参与方 {LETTERS[index]}", org="内置示例", hosting="platform", builtin=True)
            session.add(participant)
            session.flush()  # 先写参与方，数据集的外键才有效
            question, answer = SAMPLES[key]
            dataset = m.Dataset(
                id=f"ds-{key}",
                participant_id=participant.id,
                name=name,
                description=description,
                origin=origin,
                scenario="horizontal",
                task_type=TASK_TYPE,
                source="builtin",
                count=count,
                answered=count,
                sample={"question": question, "answer": answer},
            )
            session.add(dataset)
            file = BUILTIN_DIR / f"{name}.jsonl"
            if file.exists():
                rows = [json.loads(line) for line in file.read_text(encoding="utf-8").splitlines() if line.strip()]
                _store(platform, dataset, rows)
        local = m.Participant(
            id="p-local-example",
            name="示例合作方",
            org="示例机构",
            intro="演示用的本地参与方，还没有连上客户端。",
            hosting="local",
            builtin=True,
        )
        session.add(local)
        session.flush()
        session.add(
            m.Dataset(
                id="ds-local-example",
                participant_id=local.id,
                name="合作方题库",
                description="校内数学竞赛题",
                scenario="horizontal",
                task_type=TASK_TYPE,
                source="local",
            )
        )
        session.add(m.Endpoint(id=DEFAULT_ENDPOINT, name="默认 LLM 接口", kind="openai", builtin=True))
        session.add(m.Endpoint(id=FAKE_ENDPOINT, name="测试用假模型", kind="fake", models=["fake"], concurrency=16, builtin=True))
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
    imported = []
    with platform.db.session() as session:
        for key, name, _description, _origin, count in BUILTIN:
            raw = files.get(name)
            if raw is None:
                continue
            rows = [json.loads(line) for line in io.StringIO(raw.decode("utf-8")) if line.strip()]
            if len(rows) != count:
                raise ValueError(f"{name}：包里有 {len(rows)} 题，审计包应为 {count} 题")
            dataset = session.get(m.Dataset, f"ds-{key}")
            if dataset is None:
                raise ValueError(f"内置数据集 {name} 不存在，先初始化数据库")
            _store(platform, dataset, rows)
            imported.append(name)
    return imported
