"""完整对话的两组盲评，逐规则成对执行，成功单元可独立恢复。"""

from __future__ import annotations

import random
from concurrent.futures import ThreadPoolExecutor

from fedagent_sdk import ModelError

from ..common import digest, load, rows, save
from ..model import NotDispatchedPermanent
from .calls import obtain
from .healthbench import answer_messages, grade_prompt, grader_template, parse_grade, score

ARMS = ("without", "shared")


def paired_complete(row):
    return all(row["arms"].get(a, {}).get("status") == "complete" for a in ARMS)


def checkpoint(path, identity):
    value = load(path) if path.exists() else {"fingerprint": digest(identity)}
    if value["fingerprint"] != digest(identity):
        raise ValueError("evaluation-checkpoint-changed")
    return value


def save_case(path, result):
    result.pop("resultDigest", None)
    result["resultDigest"] = digest(result)
    save(path, result)


def summarize(results):
    paired = [r for r in results if paired_complete(r)]
    out = {"cases": len(results), "completePairedCases": len(paired), "incompleteCases": len(results) - len(paired), "arms": {}}
    for arm in ARMS:
        values = [r["arms"][arm]["score"] for r in paired]
        mean = sum(values) / len(values) if values else None
        out["arms"][arm] = {
            "rawMacroScore": mean,
            "clippedMacroScore": min(1, max(0, mean)) if mean is not None else None,
            "denominator": len(values),
            "missingCases": sum(r["arms"].get(arm, {}).get("status") != "complete" for r in results),
            "negativeCriteriaMet": sum(
                sum(g["criteria_met"] for g, rubric in zip(r["arms"][arm]["grades"], r["rubrics"], strict=True) if rubric["points"] < 0) for r in paired
            ),
        }
    deltas = [r["arms"]["shared"]["score"] - r["arms"]["without"]["score"] for r in paired]
    out["comparison"] = {
        "better": sum(d > 1e-12 for d in deltas),
        "worse": sum(d < -1e-12 for d in deltas),
        "same": sum(abs(d) <= 1e-12 for d in deltas),
        "deltaPoints": 100 * sum(deltas) / len(deltas) if deltas else None,
    }
    return out


def evaluate(directory, manifest, library, model):
    template = grader_template((directory / "inputs/grader-source.py").read_text())
    refs = {r["id"]: r["rubrics"] for r in rows(directory / "inputs/evaluation-references.jsonl")}
    cases = rows(directory / "inputs/evaluation-inputs.jsonl")

    def one_case(case):
        key = case["id"].removeprefix("healthbench:")
        path = directory / "evaluation" / (key + ".json")
        identity = {"prepared": manifest["fingerprint"], "case": case, "rubrics": refs[case["id"]], "model": model.identity, "library": library}
        saved = checkpoint(path, identity)
        order = list(ARMS)
        random.Random(digest({"case": case["id"], "seed": 17})).shuffle(order)
        result = {
            **saved,
            "id": case["id"],
            "question": case["question"],
            "messages": case["messages"],
            "rubrics": refs[case["id"]],
            "order": order,
            "arms": {a: {"grades": [None] * len(refs[case["id"]])} for a in ARMS},
        }
        try:
            for arm in order:
                item = result["arms"][arm]
                item["answer"] = obtain(
                    directory / "answers" / f"{key}-{arm}.json",
                    {"case": identity, "arm": arm},
                    model,
                    answer_messages(case["messages"], library if arm == "shared" else {}),
                    {"max_tokens": 1800, "temperature": 0},
                    lambda text: text.strip(),
                )
                save_case(path, result)
            for index, rubric in enumerate(result["rubrics"]):
                # 同一条规则先评完两组；不先评完一整组，再开始另一整组。
                for arm in order:
                    item = result["arms"][arm]
                    item["grades"][index] = None
                    unit_path = directory / "grades" / key / f"{index:02d}-{arm}.json"
                    prompt = grade_prompt(template, case["messages"], item["answer"], rubric)
                    item["grades"][index] = obtain(
                        unit_path, {"model": model.identity}, model, [{"role": "user", "content": prompt}], {"max_tokens": 1024, "temperature": 0}, parse_grade
                    )
                    save_case(path, result)
            for arm in ARMS:
                item = result["arms"][arm]
                item["score"] = score(result["rubrics"], item["grades"])
                item["status"] = "complete"
            result.pop("error", None)
            result.pop("permanentMissing", None)
        except (ModelError, ValueError, TypeError) as error:
            result["error"] = type(error).__name__ + ": " + str(error)
            result["permanentMissing"] = isinstance(error, NotDispatchedPermanent) or not isinstance(error, ModelError)
            for arm in ARMS:
                item = result["arms"][arm]
                item["score"] = score(result["rubrics"], item["grades"]) if "answer" in item else None
                item["status"] = "complete" if item["score"] is not None else "missing"
        save_case(path, result)
        print(f"evaluation {key}: " + ("paired complete" if all(result["arms"][a]["status"] == "complete" for a in ARMS) else "incomplete"), flush=True)
        return result

    with ThreadPoolExecutor(max_workers=2) as pool:
        return list(pool.map(one_case, cases))
