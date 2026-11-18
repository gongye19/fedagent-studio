"""原始字段适配；标准答案与评分规则始终与评测输入分离。"""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from .screen import BROAD, EXCLUDE_FOCUS, FOCUS, evidence, mcq_relevance, normalize

HEALTHBENCH_FILE = "healthbench-2025-05-07-06-14-12_oss_eval.jsonl"


def parquet(path: Path):
    import duckdb

    with duckdb.connect() as connection:
        cursor = connection.execute("SELECT * FROM read_parquet(?)", [str(path)])
        columns = [c[0] for c in cursor.description]
        for values in cursor.fetchall():
            yield dict(zip(columns, values, strict=True))


def choice(options: list[str], index: int) -> dict:
    if not 2 <= len(options) <= 10 or not isinstance(index, int) or not 0 <= index < len(options) or not options[index].strip():
        raise ValueError("选择题缺少有效答案或编号越界")
    if len({normalize(value) for value in options}) != len(options):
        raise ValueError("选择题选项重复")
    return {"options": options, "answerIndex": index, "answerText": options[index]}


def reference(options, index):
    try:
        return choice(options, index), True
    except ValueError:
        return {"rawOptions": options, "rawAnswerIndex": index}, False


def mcqa(directory: Path, stats: dict):
    for split in ("train", "validation", "test"):
        total = hits = missing = 0
        for raw in parquet(directory / f"medmcqa-{split}-00000-of-00001.parquet"):
            total += 1
            if raw["cop"] == -1:
                missing += 1
                continue
            if not BROAD.search(raw["question"]):
                continue
            hits += 1
            gold, valid = reference([raw[k] for k in ("opa", "opb", "opc", "opd")], raw["cop"])
            explanation = (raw["exp"] or "").strip()
            strict = valid and mcq_relevance(raw["question"])
            yield {
                "id": f"medmcqa:{split}:{raw['id']}",
                "source": "MedMCQA",
                "originalSplit": split,
                "group": f"medmcqa:{split}:{raw['id']}",
                "question": raw["question"],
                "reference": {**gold, "explanation": explanation},
                "subject": raw["subject_name"],
                "topic": raw["topic_name"],
                "tier": "support-knowledge" if strict else "review",
                "site": "supplement",
                "purpose": "learn-candidate"
                if split == "train" and strict and explanation
                else "knowledge-eval"
                if split == "validation" and strict
                else "review",
                "reason": "invalid-choice-options-or-label" if not valid else "exam-support-not-personal-recommendation" if strict else "broad-keyword-only",
            }
        stats[f"MedMCQA/{split}"] = {
            "total": total,
            "questionKeywordHits": hits,
            "unlabelled": missing,
        }


def mmlu(directory: Path, stats: dict):
    readme = (directory / "mmlu-clean-readme.md").read_text()
    annotations = json.loads(re.search(r"```json\s*(.*?)```", readme, re.S)[1])
    excluded = set(annotations["fact_or_stat_that_could_change"] + annotations["unrelated"] + annotations["weird_questions"])
    cleaned = {r["question_id"] for r in parquet(directory / "mmlu-clean-test-00000-of-00001.parquet")}
    total = health = hits = 0
    for raw in parquet(directory / "mmlu-test-00000-of-00001.parquet"):
        total += 1
        if raw["category"] != "health":
            continue
        health += 1
        # src catches nutrition questions which don't literally contain 'diet'.
        if not (BROAD.search(raw["question"]) or raw["src"] == "ori_mmlu-nutrition"):
            continue
        hits += 1
        gold, valid = reference(raw["options"], raw["answer_index"])
        eligible = valid and chr(65 + raw["answer_index"]) == raw["answer"] and raw["question_id"] in cleaned and raw["question_id"] not in excluded
        yield {
            "id": f"mmlu:test:{raw['question_id']}",
            "source": "MMLU-Pro Health",
            "originalSplit": "test",
            "group": f"mmlu:{raw['question_id']}",
            "question": raw["question"],
            "reference": gold,
            "topic": raw["src"],
            "tier": "support-knowledge" if eligible else "review",
            "purpose": "knowledge-eval" if eligible else "review",
            "reason": "nutrition-exam-only" if eligible else "documented-issue-or-cleaned-exclusion",
        }
    stats["MMLU-Pro/test"] = {
        "total": total,
        "health": health,
        "questionOrNutritionSourceHits": hits,
        "cleanedRowsNotAdditionalData": len(cleaned),
    }


def medquad(directory: Path, stats: dict):
    total = answered = hits = 0
    with zipfile.ZipFile(directory / "medquad.zip") as archive:
        for name in sorted(archive.namelist()):
            if not name.endswith(".xml"):
                continue
            root = ET.fromstring(archive.read(name))
            focus = root.findtext("Focus") or ""
            document = "/".join(Path(name).parts[-2:])
            for ordinal, pair in enumerate(root.findall("./QAPairs/QAPair")):
                total += 1
                answer = (pair.findtext("Answer") or "").strip()
                if not answer:
                    continue
                answered += 1
                question = pair.find("Question")
                if question is None:
                    continue
                excerpts = evidence(answer)
                if not (excerpts or BROAD.search(question.text or "")):
                    continue
                hits += 1
                collection = Path(document).parts[0]
                allowed = collection.startswith(("4_MPlus_", "5_NIDDK_", "7_Senior", "8_NHLBI_"))
                strict = bool(
                    allowed
                    and FOCUS.search(focus)
                    and not EXCLUDE_FOCUS.search(focus)
                    and excerpts
                    and question.attrib.get("qtype") in ("information", "treatment", "prevention", "considerations")
                )
                yield {
                    "id": f"medquad:{document}:{question.attrib.get('qid', ordinal)}",
                    "source": "MedQuAD",
                    "originalSplit": "unsplit",
                    "group": "medquad:" + focus.casefold().strip(),
                    "document": document,
                    "focus": focus,
                    "question": question.text or "",
                    "reference": {"answer": answer, "evidence": excerpts},
                    "url": root.attrib.get("url"),
                    "site": "A" if collection.startswith("5_NIDDK_") else "B" if collection.startswith("8_NHLBI_") else "C",
                    "tier": "recommendation-evidence" if strict else "review",
                    "purpose": "learn-candidate" if strict else "review",
                    "reason": "lifestyle-context-in-answer" if strict else "broad-or-specialist-only",
                }
    stats["MedQuAD"] = {
        "total": total,
        "withAnswers": answered,
        "contextOrQuestionHits": hits,
    }


def healthbench(directory: Path, policy: dict, stats: dict):
    selected = set(policy["healthbench"])
    seen = set()
    rows = [json.loads(line) for line in (directory / HEALTHBENCH_FILE).open()]
    hits = 0
    for raw in rows:
        identifier = raw["prompt_id"]
        seen.add(identifier)
        matched = bool(BROAD.search(raw["prompt"][-1]["content"]))
        hits += matched
        rubrics = raw["rubrics"]
        if not rubrics or sum(r["points"] for r in rubrics if r["points"] > 0) <= 0:
            raise ValueError("HealthBench 缺少正分规则")
        yield {
            "id": "healthbench:" + identifier,
            "source": "HealthBench",
            "originalSplit": "evaluation-only",
            "group": "healthbench:" + identifier,
            "question": raw["prompt"][-1]["content"],
            "messages": raw["prompt"],
            "reference": {"rubrics": rubrics},
            "tier": "recommendation-eval" if identifier in selected else "review",
            "purpose": "recommendation-eval" if identifier in selected else "protected-eval",
            "reason": policy["healthbench"].get(identifier, "not-in-topical-english-selection"),
        }
    if not selected <= seen:
        raise ValueError("HealthBench 审核编号在固定来源中不存在")
    stats["HealthBench"] = {
        "total": len(rows),
        "lastMessageKeywordHits": hits,
        "topicallySelected": len(selected),
    }
