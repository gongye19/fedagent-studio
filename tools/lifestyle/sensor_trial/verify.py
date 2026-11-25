"""只读 SQLite／请求检查点复验；全部预测完成后才加载评分参考。"""

import csv
import json
import sqlite3
from collections import Counter
from contextlib import closing

from ..common import digest, load, rows, save
from ..sensor_samples.common import number, rounded
from ..sensor_samples.metrics import macro_score
from .adapter import SETTINGS, TARGET, messages, prediction
from .prepare import file_hash, validate
from .recovery import receipt, related_calls
from .retrieval import retrieve
from .run import checked_ledger


def verify_federation(directory, plan):
    state = load(directory / "batch-01/state.json")
    attempts = checked_ledger(directory, plan)
    if (
        state["status"] != "complete"
        or state["fingerprint"] != plan["fingerprint"]
        or set(state["sites"]) != set("ABC")
        or not 1 <= state["federationAttempts"] <= 28 - related_calls(directory, plan)
        or len(attempts) < state["federationAttempts"]
    ):
        raise ValueError("algorithm-completion-receipt-invalid")
    uri = (directory / "platform/fedagent.db").resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as db:
        db.row_factory = sqlite3.Row
        task = db.execute("SELECT * FROM tasks WHERE id=?", (state["taskId"],)).fetchone()
        config = json.loads(task["config"]) if task else {}
        if (
            not task
            or task["status"] != "completed"
            or task["plugin_hash"] != plan["implementation"]["plugin"]
            or task["algorithm"] != "fot-records"
            or config.get("params") != plan["params"]
            or config.get("rounds") != 1
            or config.get("clientModel") != plan["modelRef"]
            or config.get("serverModel") != plan["modelRef"]
        ):
            raise ValueError("frozen-original-algorithm-task-changed")
        for site, binding in state["sites"].items():
            expected = rows(directory / f"inputs/batch-01-{site}.jsonl")
            dataset = db.execute("SELECT * FROM datasets WHERE id=?", (binding["datasetId"],)).fetchone()
            if (
                not dataset
                or dataset["participant_id"] != binding["participantId"]
                or dataset["count"] != 2
                or dataset["source_hash"] != file_hash(directory / f"inputs/batch-01-{site}.jsonl")
            ):
                raise ValueError("uploaded-observation-dataset-changed")
            data_root = (directory / "platform/datasets").resolve()
            data_path = (data_root / dataset["content_path"]).resolve()
            if not data_path.is_relative_to(data_root) or digest(rows(data_path)) != digest(expected):
                raise ValueError("uploaded-observation-content-changed")
            units = list(db.execute("SELECT * FROM work_units WHERE task_id=? AND site_id=?", (task["id"], binding["participantId"])))
            ids = {r["id"] for r in expected}
            for step in ("prepare", "reflect", "extract"):
                if {u["unit_key"] for u in units if u["step"] == step and u["status"] == "done"} != ids:
                    raise ValueError("incomplete-observation-processing")
            traces = list(
                db.execute(
                    "SELECT item_id FROM messages WHERE task_id=? AND sender_site=? AND channel='trace'",
                    (task["id"], binding["participantId"]),
                )
            )
            coverage = Counter(t["item_id"] for t in traces)
            if set(coverage) - ids or any(n > 3 for n in coverage.values()):
                raise ValueError("original-max-three-traces-violated")
            usage = state["sourceUsage"][site]
            if (
                usage["traceCount"] != sum(coverage.values())
                or usage["zeroTraceItems"] != len(ids - set(coverage))
                or any(usage[key] != 2 for key in ("uploaded", "processedItems", "reflectedItems", "extractedUnits"))
            ):
                raise ValueError("source-usage-receipt-changed")
        artifact = list(db.execute("SELECT content FROM artifacts WHERE task_id=?", (task["id"],)))
        app = db.execute("SELECT * FROM apps WHERE id=?", (state["appId"],)).fetchone()
        library = load(directory / "batch-01/library.json")
        if (
            len(artifact) != 1
            or not app
            or app["task_id"] != task["id"]
            or not isinstance(library, dict)
            or not library
            or digest(library) != state["libraryDigest"]
            or json.loads(artifact[0]["content"]) != library
            or json.loads(app["content"]) != library
            or len(library) != state["finalEntries"]
        ):
            raise ValueError("published-original-library-changed")
    return library, state


def answer_value(directory, plan, case, arm, library):
    selected, audit = retrieve(case["input"], library)
    request_messages = messages(case["input"], selected if arm == "shared" else {})
    body = {"ref": plan["modelRef"], "identity": plan["identity"], "messages": request_messages, "settings": SETTINGS}
    key = digest(body)
    unit = load(directory / f"answers/{case['id']}-{arm}.json")
    receipt = load(directory / f"answers/{case['id']}-{arm}-receipt.json")
    if (
        unit["fingerprint"] != digest({k: body[k] for k in ("identity", "messages", "settings")})
        or "value" not in unit
        or digest(unit["value"]) != unit.get("valueDigest")
        or receipt != {"case": case["id"], "arm": arm, "requestHash": key, "retrieval": audit if arm == "shared" else None}
    ):
        raise ValueError("answer-unit-or-retrieval-changed")
    cache = load(directory / f"meter/calls/{key}.json")
    if (
        cache["request"] != body
        or cache.get("rejected")
        or cache.get("resultDigest") != digest(cache["result"])
        or cache["result"].get("finish_reason") not in (None, "stop")
        or prediction(cache["result"]["text"]) != unit["value"]
    ):
        raise ValueError("answer-does-not-match-valid-model-result")
    return unit["value"], audit if arm == "shared" else None


def verify(directory, *, completing=False):
    plan = validate(directory)
    library, state = verify_federation(directory, plan)
    attempts = checked_ledger(directory, plan)
    cases = rows(directory / "inputs/evaluation.jsonl")
    answers = {case["id"]: {arm: answer_value(directory, plan, case, arm, library) for arm in ("baseline", "shared")} for case in cases}
    # 此前只验证参考文件的字节摘要；全部回答验真后才解析其内容用于数值评分。
    references = {r["id"]: r for r in rows(directory / "inputs/references.jsonl")}
    results, scores = [], {}
    for case in cases:
        ref = references[case["id"]]
        truth = ref["observed_outcome"][TARGET]
        pair = answers[case["id"]]
        predictions = {arm: pair[arm][0][TARGET] for arm in pair}
        errors = {arm: rounded(abs(number(value) - number(truth))) for arm, value in predictions.items()}
        diff = number(errors["shared"]) - number(errors["baseline"])
        results.append(
            {
                "id": case["id"],
                "participant_id": ref["participant_id"],
                "observed": truth,
                "predictions": predictions,
                "absoluteErrors": errors,
                "change": "improved" if diff < 0 else "worse" if diff > 0 else "same",
                "retrieval": pair["shared"][1],
            }
        )
    for arm in ("baseline", "shared"):
        scores[arm] = macro_score(
            [{"participant_id": r["participant_id"], "truth": r["observed"], "prediction": r["predictions"][arm]} for r in results]
        )
    if not all(s["complete"] and s["cases"] == 6 for s in scores.values()):
        raise ValueError("incomplete-paired-evaluation")
    baseline = number(scores["baseline"]["conditional_user_macro_mae"])
    shared = number(scores["shared"]["conditional_user_macro_mae"])
    result = {
        "status": "complete",
        "fingerprint": plan["fingerprint"],
        "model": plan["identity"],
        "learningCases": 6,
        "evaluationCases": 6,
        "experienceEntries": len(library),
        "sourceUsage": state["sourceUsage"],
        "scores": scores,
        "maeDeltaSharedMinusBaseline": rounded(shared - baseline),
        "relativeErrorReduction": rounded((baseline - shared) / baseline) if baseline else None,
        "changes": dict(Counter(r["change"] for r in results)),
        "cases": results,
        "attempts": len(attempts),
        "federationAttempts": state["federationAttempts"],
        "cap": 40,
        "paidErrorsWithReportedUsage": sum(r["status"] == "error" and "usage" in r for r in attempts),
        "unknownCostAttempts": sum(r["status"] == "error" and "usage" not in r for r in attempts),
        "relatedDiagnosticCalls": related_calls(directory, plan),
        "totalCountedDispatches": len(attempts) + related_calls(directory, plan),
        "recovered": receipt(directory, plan) is not None,
        "usage": {k: sum(r.get("usage", {}).get(k, 0) for r in attempts) for k in ("prompt_tokens", "completion_tokens")},
        "deployed": False,
        "recommendationEffectProven": False,
    }
    if completing:
        save(directory / "report.json", result)
        write_report(directory, result)
    else:
        if (
            load(directory / "COMPLETE.json") != {"fingerprint": plan["fingerprint"], "reportDigest": digest(result)}
            or load(directory / "report.json") != result
        ):
            raise ValueError("completed-report-changed")
    return result


def write_report(directory, result):
    lines = [
        "# CGMacros：六学六测链路小试",
        "",
        "三组模拟站点各2条学习记录，6个不同留出用户。同模型，两组只差经验上下文。",
        "",
        "指标是血糖正增量面积预测的用户宏平均绝对误差（mg/dL·min），越低越好。不是推荐准确率或临床收益。",
        "",
        "|无经验MAE|有经验MAE|变化（有−无）|",
        "|---:|---:|---:|",
    ]
    lines.append(
        "|"
        + "|".join(str(result["scores"][a]["conditional_user_macro_mae"]) for a in ("baseline", "shared"))
        + "|"
        + result["maeDeltaSharedMinusBaseline"]
        + "|"
    )
    lines += [
        "",
        f"变化：{result['changes']}；经验{result['experienceEntries']}条；实际派发{result['attempts']}/40。",
        f"另计连接诊断{result['relatedDiagnosticCalls']}次，合计{result['totalCountedDispatches']}/40；其中{result['unknownCostAttempts']}次失败调用用量未知，未按零费用处理。",
        "",
        "|来源|处理记录|零经验记录|上传trace|最终经验库|",
        "|---|---:|---:|---:|---|",
    ]
    for site, usage in result["sourceUsage"].items():
        lines.append(f"|模拟站点{site}|{usage['processedItems']}|{usage['zeroTraceItems']}|{usage['traceCount']}|三站共同聚合|")
    lines += [
        "",
        "## 全部留出样本",
        "",
        "|病例|观测值|无经验预测|有经验预测|无经验误差|有经验误差|变化|",
        "|---|---:|---:|---:|---:|---:|---|",
    ]
    with (directory / "cases.csv").open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(
            ["id", "participant", "observed", "baseline", "shared", "baseline_absolute_error", "shared_absolute_error", "change"]
        )
        for row in result["cases"]:
            values = [
                row["observed"],
                row["predictions"]["baseline"],
                row["predictions"]["shared"],
                row["absoluteErrors"]["baseline"],
                row["absoluteErrors"]["shared"],
                row["change"],
            ]
            writer.writerow([row["id"], row["participant_id"], *values])
            lines.append("|" + "|".join([row["id"], *map(str, values)]) + "|")
    lines += [
        "",
        "## 限制",
        "",
        "仅六例链路验证，不外推总体效果；观测餐食不等于干预建议，CGM包含原数据插值。学习记录是确定性计算摘要，非Agent问诊。",
        "经验按输入字符串值排序、最多4条且整条保留；可能全部使用或退回固定顺序，逐例见report.json。",
        "调用数指模型桥派发，含格式重试；供应商兼容回退可能涉及多次HTTP请求，不能等同账单次数。平台未配置单价，不编造金额。",
        "未跑LifeSnaps或全量，未修改原FoT、旧数据或线上应用，未部署。",
    ]
    (directory / "report.md").write_text("\n".join(lines) + "\n")
