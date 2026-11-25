"""全离线回证实际上传、原算法产物、回答及匿名评分；不重新生成任何答案。"""

import json
import sqlite3
from collections import Counter
from contextlib import closing

from ..common import digest, load, rows, save
from .prepare import file_hash, validate
from .run import answers, generated_records, judging
from .units import checked_ledger


def verify_federation(directory, plan, records):
    state = load(directory / "batch-01/state.json")
    if state["status"] != "complete" or state["fingerprint"] != plan["fingerprint"] or set(state["sites"]) != set("ABC"):
        raise ValueError("algorithm-not-complete")
    uri = (directory / "platform/fedagent.db").resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as db:
        db.row_factory = sqlite3.Row
        task = db.execute("SELECT * FROM tasks WHERE id=?", (state["taskId"],)).fetchone()
        config = json.loads(task["config"]) if task else {}
        if (
            not task
            or task["status"] != "completed"
            or task["algorithm"] != "fot-records"
            or task["plugin_hash"] != plan["implementation"]["plugin"]
            or config.get("params") != plan["params"]
            or config.get("rounds") != 1
            or config.get("clientModel") != plan["modelRef"]
            or config.get("serverModel") != plan["modelRef"]
        ):
            raise ValueError("original-algorithm-changed")
        for site, binding in state["sites"].items():
            dataset = db.execute("SELECT * FROM datasets WHERE id=?", (binding["datasetId"],)).fetchone()
            path = directory / f"inputs/batch-01-{site}.jsonl"
            if (
                not dataset
                or dataset["participant_id"] != binding["participantId"]
                or dataset["count"] != 2
                or dataset["source_hash"] != file_hash(path)
                or rows(path) != records[site]
            ):
                raise ValueError("uploaded-advice-changed")
            data_root = (directory / "platform/datasets").resolve()
            data_path = (data_root / dataset["content_path"]).resolve()
            if not data_path.is_relative_to(data_root) or rows(data_path) != records[site]:
                raise ValueError("platform-records-changed")
            ids = {r["id"] for r in records[site]}
            units = list(db.execute("SELECT * FROM work_units WHERE task_id=? AND site_id=?", (task["id"], binding["participantId"])))
            for step in ("prepare", "reflect", "extract"):
                if {u["unit_key"] for u in units if u["step"] == step and u["status"] == "done"} != ids:
                    raise ValueError("incomplete-advice-processing")
            traces = list(
                db.execute(
                    "SELECT item_id FROM messages WHERE task_id=? AND sender_site=? AND channel='trace'",
                    (task["id"], binding["participantId"]),
                )
            )
            coverage = Counter(t["item_id"] for t in traces)
            usage = state["sourceUsage"][site]
            if (
                set(coverage) - ids
                or any(n > 3 for n in coverage.values())
                or usage["traceCount"] != sum(coverage.values())
                or usage["zeroTraceItems"] != len(ids - set(coverage))
                or any(usage[k] != 2 for k in ("uploaded", "processedItems", "reflectedItems", "extractedUnits"))
            ):
                raise ValueError("native-trace-coverage-changed")
        artifact = list(db.execute("SELECT content FROM artifacts WHERE task_id=?", (task["id"],)))
        app = db.execute("SELECT * FROM apps WHERE id=?", (state["appId"],)).fetchone()
        library = load(directory / "batch-01/library.json")
        if (
            len(artifact) != 1
            or not app
            or app["task_id"] != task["id"]
            or not isinstance(library, dict)
            or not library
            or not all(isinstance(k, str) and isinstance(v, str) and v.strip() for k, v in library.items())
            or digest(library) != state["libraryDigest"]
            or json.loads(artifact[0]["content"]) != library
            or json.loads(app["content"]) != library
            or len(library) != state["finalEntries"]
        ):
            raise ValueError("native-library-changed")
    return library, state


def rates(scores, arm, keys):
    passes = sum(scores[c][arm][k]["pass"] for c in scores for k in keys)
    total = len(scores) * len(keys)
    return {"passed": passes, "total": total, "percent": round(100 * passes / total, 2)}


def verify(directory, *, completing=False):
    plan = validate(directory)
    attempts = checked_ledger(directory, plan)
    records = generated_records(directory, plan)
    library, state = verify_federation(directory, plan, records)
    cases, replies = answers(directory, plan, library)
    scores = judging(directory, plan, cases, replies)
    protected = load(directory / "verification/protected-before.json")
    groups = {
        arm: {"utility": rates(scores, arm, ["U1", "U2", "U3", "U4"]), "safety": rates(scores, arm, ["S1", "S2", "S3", "S4"])}
        for arm in ("baseline", "shared")
    }
    details = []
    for case in cases:
        c = case["id"]
        points = {arm: sum(scores[c][arm][k]["pass"] for k in ("U1", "U2", "U3", "U4")) for arm in groups}
        details.append(
            {
                "id": c,
                "input": case["input"],
                "answers": replies[c],
                "scores": scores[c],
                "utilityDelta": points["shared"] - points["baseline"],
            }
        )
    result = {
        "fingerprint": plan["fingerprint"],
        "status": "complete",
        "learningCases": 6,
        "evaluationCases": 6,
        "sourceUsage": state["sourceUsage"],
        "finalEntries": len(library),
        "traceCount": sum(s["traceCount"] for s in state["sourceUsage"].values()),
        "attempts": len(attempts),
        "callCap": plan["globalCallCap"],
        "failedAttempts": sum(r["status"] == "error" for r in attempts),
        "unknownUsageAttempts": sum("usage" not in r for r in attempts),
        "knownUsage": {k: sum(r.get("usage", {}).get(k, 0) for r in attempts) for k in ("prompt_tokens", "completion_tokens")},
        "groups": groups,
        "utilityDeltaPercentagePoints": round(groups["shared"]["utility"]["percent"] - groups["baseline"]["utility"]["percent"], 2),
        "paired": {
            "better": sum(c["utilityDelta"] > 0 for c in details),
            "same": sum(c["utilityDelta"] == 0 for c in details),
            "worse": sum(c["utilityDelta"] < 0 for c in details),
        },
        "protectedFilesUnchanged": len(protected),
        "clinicalBenefitProven": False,
        "sameModelJudge": True,
        "deployed": False,
        "limitations": [
            "仅6位留出用户，非临床有效性评测",
            "模型生成建议与同模型固定规则评分，非医生核验",
            "两组都有相同官方依据，仅比较新增经验的边际作用",
            "历史观测不是推荐有效性标签；未评测LifeSnaps或运动处方",
        ],
        "cases": details,
    }
    complete = directory / "COMPLETE.json"
    if complete.exists():
        receipt = load(complete)
        if receipt != {"fingerprint": plan["fingerprint"], "reportDigest": digest(result)} or load(directory / "report.json") != result:
            raise ValueError("completed-report-changed")
    elif not completing:
        raise ValueError("missing-completion-receipt")
    if completing:
        save(directory / "report.json", result)
        lines = [
            "# CGMacros饮食推荐小试",
            "",
            f"原FoT：6条模型模拟饮食建议 → {result['traceCount']}条候选 → {len(library)}条经验。",
            f"模型派发{len(attempts)}/{plan['globalCallCap']}次，失败{result['failedAttempts']}次，未知用量{result['unknownUsageAttempts']}次。",
            "",
            "|组别|实用性（固定4项）|安全边界（固定4项）|",
            "|---|---:|---:|",
        ]
        for arm, name in (("baseline", "无经验"), ("shared", "加载经验")):
            g = groups[arm]
            lines.append(
                f"|{name}|{g['utility']['passed']}/{g['utility']['total']}（{g['utility']['percent']}%）|"
                f"{g['safety']['passed']}/{g['safety']['total']}（{g['safety']['percent']}%）|"
            )
        lines += [
            "",
            f"实用性差值：{result['utilityDeltaPercentagePoints']:+.2f}个百分点。逐病例：{result['paired']}。",
            "",
            *["- " + s for s in result["limitations"]],
            "",
            "## 完整配对回答与评分",
        ]
        for case in details:
            lines += ["", "### " + case["id"], "", "输入：" + json.dumps(case["input"], ensure_ascii=False)]
            for arm, name in (("baseline", "无经验"), ("shared", "加载经验")):
                lines += ["", "**" + name + "**", "", case["answers"][arm], "", json.dumps(case["scores"][arm], ensure_ascii=False)]
        (directory / "report.md").write_text("\n".join(lines) + "\n")
    return result
