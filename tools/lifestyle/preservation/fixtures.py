"""两个有人工字段标注的离线验收夹具；不是新生成的经验或收益测试。"""

import hashlib
from html.parser import HTMLParser

from ..common import digest, load, rows
from .reference import PROTOCOL, validate_reference

SOURCE_FILE = "full/run-20261119/generation/inputs/source-records.jsonl"
EXERCISE_ID = "guidance:023c8edd5c6ef1a50c28:1"
PLATE_FILE = "knowledge/final4-20261118/raw/21bd990a99f267733bc7.html"
AUDIT_SNAPSHOT = "quality-audit/run-20261125/protected-before.json"


class ArchivedText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skipped, self.parts = 0, []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.skipped += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.skipped = max(0, self.skipped - 1)

    def handle_data(self, text):
        if not self.skipped:
            self.parts.append(text)


def published_source(identifier, body, metadata):
    return {"id": identifier, "kind": "published-source", "body": body, "bodyDigest": digest(body), "metadata": metadata}


def reference(identifier, source, specs):
    value = {
        "protocol": PROTOCOL,
        "id": identifier,
        "kind": "guideline-action",
        "evidenceKind": "official-guidance",
        "sources": [source],
        "fields": {
            key: {
                "value": fact,
                "support": [{"sourceId": source["id"], "quote": q} for q in (quote if isinstance(quote, list) else [quote])],
                "annotation": annotation,
            }
            for key, (fact, quote, annotation) in specs.items()
        },
        "review": {"reviewer": "Codex人工上下文标注", "scope": "source-context-and-field-annotation", "medicalEfficacyReviewed": False},
    }
    return validate_reference(value)


def exercise_reference(row):
    source = published_source(
        row["id"],
        row["body"],
        {
            "url": row["url"],
            "version": row["payloadDigest"],
            "dateStatus": row["original"]["sourceDates"],
            "sectionDigest": digest(row["body"]),
        },
    )
    source["metadata"]["dateStatus"] = "source dates: " + "; ".join(row["original"]["sourceDates"])
    return reference(
        "older-adult-aerobic",
        source,
        {
            "population": ({"group": "older-adults"}, "Older adults need 150 minutes", "保留原文人群，不推导任意年龄或所有人的个人处方。"),
            "goal": (
                {"role": "population-weekly-target", "individualStartingDose": "not-determined"},
                "each week",
                "目标性质与适用边界为人工上下文标注。",
            ),
            "action": (
                {"type": "aerobic-activity", "combination": "alternatives-or-equivalent-combination"},
                "Or they could get an equivalent combination",
                "等效或替代关系，不能把两条路径机械相加。",
            ),
            "parameters": (
                [
                    {"amount": 150, "unit": "minutes", "period": "week", "intensity": "moderate"},
                    {"amount": 75, "unit": "minutes", "period": "week", "intensity": "vigorous"},
                ],
                ["150 minutes of moderate-intensity aerobic physical activity each week", "75 minutes a week of vigorous-intensity"],
                "完整数值映射另经原文上下文标注；片段存在不单独证明字段语义正确。",
            ),
            "exceptions": (
                {"chronicConditions": "professional-individualization"},
                "People with chronic conditions may want to talk to a health care professional",
                "保留原文例外，未制造禁忌或保证安全。",
            ),
            "unknowns": (
                ["individual-capacity", "personal-starting-amount"],
                "Everyone's fitness level is different.",
                "未由群体目标推导个人起始量。",
            ),
        },
    )


def plate_reference(root):
    path = root / PLATE_FILE
    raw = path.read_bytes()
    url = "https://www.cdc.gov/diabetes/healthy-eating/diabetes-meal-planning.html"
    if f'<link rel="canonical" href="{url}"' not in raw.decode():
        raise ValueError("archived-plate-source-identity")
    parser = ArchivedText()
    parser.feed(raw.decode())
    body = " ".join(" ".join(parser.parts).split())
    source = published_source(
        "archived-cdc-plate",
        body,
        {
            "url": url,
            "version": hashlib.sha256(raw).hexdigest(),
            "dateStatus": "已保存的T147原始HTML；不将本次读取日期冒称网页更新日期。",
            "archivePath": PLATE_FILE,
        },
    )
    return reference(
        "diabetes-plate-structure",
        source,
        {
            "population": ({"context": "diabetes-meal-planning"}, "Diabetes Meal Planning", "原文页面场景，不泛化为所有人的个体目标。"),
            "goal": (
                {"role": "general-plate-template", "individualGramTarget": "not-determined"},
                "Work with your doctor or a registered dietitian",
                "餐盘比例和个人克数目标分开。",
            ),
            "action": ({"type": "plate-structure"}, "Try the plate method", "只保留已支持的安排方法，不假造实施效果。"),
            "parameters": (
                [
                    {"component": "nonstarchy-vegetables", "fraction": "1/2"},
                    {"component": "lean-protein", "fraction": "1/4"},
                    {"component": "carbohydrate-foods", "fraction": "1/4"},
                ],
                ["Fill half with nonstarchy veggies", "Fill one quarter with a lean protein", "Fill one quarter with carb foods"],
                "三项比例按原文人工标注，不用单一片段替代整段语义审核。",
            ),
            "exceptions": (
                {"individualPlan": ["goals", "tastes", "lifestyle", "medicines"]},
                "A good meal plan will consider your goals",
                "个人计划要考虑的条件，不将模板当治疗处方。",
            ),
            "unknowns": (["personal-carbohydrate-target"], "find out how many carbs you should aim for", "原文未给该用户具体克数。"),
        },
    )


def build_references(root):
    approved = load(root / AUDIT_SNAPSHOT)
    for name in (SOURCE_FILE, PLATE_FILE):
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != approved[name]:
            raise ValueError("approved-source-snapshot-changed")
    pool = rows(root / SOURCE_FILE)
    if len(pool) != 444 or len({r["id"] for r in pool}) != 444:
        raise ValueError("original-444-source-pool-changed")
    exercise = next(r for r in pool if r["id"] == EXERCISE_ID)
    return pool, [exercise_reference(exercise), plate_reference(root)]
