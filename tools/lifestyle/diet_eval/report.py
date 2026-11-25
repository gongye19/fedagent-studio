"""逐案例展示核心建议、差异及评分理由；主试验与重复运行分开统计。"""

import html
import json
from collections import Counter

from ..common import digest, load, save
from .meter import ledgers
from .prepare import validate
from .protocol import assessed, compare
from .run import execute
from .specs import DIMENSIONS


def aggregate(items):
    result = {"cases": len(items), "comparison": dict(Counter(item["comparison"] for item in items)), "arms": {}}
    for arm in ("baseline", "shared"):
        result["arms"][arm] = {
            "meanTotalOutOf8": sum(i["assessment"][arm]["total"] for i in items) / len(items),
            "criticalRiskCases": sum(not i["assessment"][arm]["acceptable"] for i in items),
            "dimensions": {key: sum(i["assessment"][arm]["dimensions"][key] for i in items) / len(items) for key in DIMENSIONS},
        }
    result["deltaOutOf8"] = result["arms"]["shared"]["meanTotalOutOf8"] - result["arms"]["baseline"]["meanTotalOutOf8"]
    return result


def verify(directory, *, completing=False):
    plan = validate(directory)
    ledger = ledgers(directory, plan)
    raw, refs = execute(directory, plan)
    items = []
    for row in raw:
        ref = refs[row["case"]["id"]]
        assessment = {arm: assessed(ref, row["judgments"][arm]) for arm in ("baseline", "shared")}
        items.append(
            {
                "id": row["case"]["id"],
                "title": row["case"]["title"],
                "namespace": row["namespace"],
                "messages": row["case"]["messages"],
                "answers": row["answers"],
                "assessment": assessment,
                "comparison": compare(assessment["baseline"], assessment["shared"]),
                "differences": row["differences"],
                "expected": ref["expected"],
                "retrieval": row["retrieval"],
            }
        )
    primary = [i for i in items if i["namespace"] == "primary"]
    repeat = [i for i in items if i["namespace"] == "repeat"]
    if len(primary) != 6 or len(repeat) != 2:
        raise ValueError("complete-six-primary-two-repeat-required")
    p = {r["id"]: r for r in primary}
    stability = [
        {
            "id": r["id"],
            "primary": p[r["id"]]["comparison"],
            "repeat": r["comparison"],
            "sameDirection": p[r["id"]]["comparison"] == r["comparison"],
        }
        for r in repeat
    ]
    attempts = [v for values in ledger.values() for v in values]
    result = {
        "fingerprint": plan["fingerprint"],
        "status": "complete",
        "primary": aggregate(primary),
        "repeat": aggregate(repeat),
        "stability": stability,
        "attempts": len(attempts),
        "callCap": plan["globalCallCap"],
        "failedDispatches": sum(r["status"] == "error" for r in attempts),
        "unknownUsageDispatches": sum("usage" not in r for r in attempts),
        "knownUsage": {key: sum(r.get("usage", {}).get(key, 0) for r in attempts) for key in ("prompt_tokens", "completion_tokens")},
        "source": "HealthBench six previously unused conversations, original rubrics plus declared supplements; adapted evaluation, not official scores",
        "grading": "same-model blinded rule grading; deterministic 0/1/2 dimension aggregation; critical risks reported separately",
        "priorFilesUnchanged": len(load(directory / "verification/protected-before.json")),
        "clinicalBenefitProven": False,
        "experienceHealthBenefitValidated": False,
        "deployed": False,
        "cases": items,
    }
    if (directory / "COMPLETE.json").exists():
        if (
            load(directory / "COMPLETE.json") != {"fingerprint": plan["fingerprint"], "reportDigest": digest(result)}
            or load(directory / "report.json") != result
        ):
            raise ValueError("completed-result-changed")
    elif not completing:
        raise ValueError("no-completion-receipt")
    if completing:
        save(directory / "report.json", result)
        write_reports(directory, result, refs)
    return result


def write_reports(directory, result, refs):
    labels = {"better": "加载经验更好", "same": "持平", "worse": "加载经验更差", "both_unacceptable": "两组均触及关键风险"}
    lines = [
        "# 饮食推荐两组对照",
        "",
        "同案例、同模型、同应用提示；唯一差异为是否提供匹配经验。",
        "",
        "主结果6案例，另2案例重复独立派发，不把重复当新增样本。四维各0–2分；关键风险不能被总分抵消。",
        "",
        "|案例|无经验 /8|加载经验 /8|结果|",
        "|---|---:|---:|---|",
    ]
    for row in result["cases"]:
        if row["namespace"] == "primary":
            lines.append(
                f"|{row['title']}|{row['assessment']['baseline']['total']}|{row['assessment']['shared']['total']}|{labels[row['comparison']]}|"
            )
    lines += [
        "",
        "主结果：" + json.dumps(result["primary"], ensure_ascii=False),
        "",
        "重复稳定性：" + json.dumps(result["stability"], ensure_ascii=False),
        "",
        "仅为少量公开案例上的推荐质量检查；同模型评分和补充规则未经独立医学专家核验，不能认定真实健康改善或官方HealthBench成绩。",
        f"派发{result['attempts']}/{result['callCap']}；失败{result['failedDispatches']}；未知usage {result['unknownUsageDispatches']}，未算作零费用。",
        "",
    ]
    sections = []
    for row in result["cases"]:
        name = row["title"] + (" · 重复" if row["namespace"] == "repeat" else "")
        lines += ["## " + name, "", "本例要求：" + row["expected"], "", "差异：" + "；".join(row["differences"]), ""]
        columns = []
        for arm, title in (("baseline", "无经验"), ("shared", "加载经验")):
            item = row["assessment"][arm]
            lines += ["### " + title, "", row["answers"][arm], "", "评分：" + json.dumps(item, ensure_ascii=False), ""]
            bars = "".join(
                f'<div class="metric"><span>{html.escape(label)}</span><meter min="0" max="2" value="{item["dimensions"][key]}"></meter><b>{item["dimensions"][key]}/2</b></div>'
                for key, label in DIMENSIONS.items()
            )
            actions = "".join(f"<li>{html.escape(action)}</li>" for action in item["coreRecommendations"])
            risks = "；".join(refs[row["id"]]["rules"][key] for key in item["criticalRisks"])
            columns.append(
                f'<article><h3>{title} · {item["total"]}/8</h3>{bars}<p class="risk">{html.escape("关键风险：" + risks if risks else "未命中本例预设关键风险项")}</p><h4>核心建议（评分器提炼）</h4><ul>{actions}</ul><details open><summary>完整原始回答</summary><div class="answer">{html.escape(row["answers"][arm])}</div></details><p class="reason">评分理由：{html.escape(item["judgeReason"])}</p></article>'
            )
        sections.append(
            f'<section id="case-{len(sections)}"><h2>{html.escape(name)} · {labels[row["comparison"]]}</h2><p>本例要求：{html.escape(row["expected"])}</p><div class="columns">{"".join(columns)}</div><p>具体差异：{html.escape("；".join(row["differences"]) or "评分器未指出实质建议差异")}</p><details><summary>原始对话与加载条目</summary><pre>{html.escape(json.dumps({"messages": row["messages"], "retrieval": row["retrieval"]}, ensure_ascii=False, indent=2))}</pre></details></section>'
        )
    (directory / "report.md").write_text("\n".join(lines) + "\n")
    nav = "".join(
        f'<a href="#case-{i}">{html.escape(r["title"])}{" · 重复" if r["namespace"] == "repeat" else ""}</a>'
        for i, r in enumerate(result["cases"])
    )
    css = "body{margin:0;background:#f7f8fa;color:#202124;font:15px/1.65 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:32px 24px}h1,h2,h3{line-height:1.35}h2{font-size:20px}h3{font-size:17px;margin:0 0 16px}nav{display:flex;gap:10px;flex-wrap:wrap}a{color:#245de7}section{margin:28px 0;border-top:1px solid #dfe2e7;padding-top:20px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:white;border:1px solid #dfe2e7;border-radius:12px;padding:20px;min-width:0}.metric{display:grid;grid-template-columns:110px 1fr 36px;align-items:center;gap:12px;margin:6px 0}meter{width:100%;height:12px}.answer{white-space:pre-wrap;overflow-wrap:anywhere;border-top:1px solid #e7e9ed;padding-top:16px}.reason,.risk{color:#626772;font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere}.summary{padding:16px;background:white;border:1px solid #dfe2e7;border-radius:10px}@media(max-width:720px){main{padding:20px 14px}.columns{grid-template-columns:1fr}.metric{grid-template-columns:100px 1fr 32px}}"
    primary = result["primary"]
    counts = primary["comparison"]
    summary = (
        f"6 个独立案例：更好 {counts.get('better', 0)} · 持平 {counts.get('same', 0)} · 更差 {counts.get('worse', 0)}"
        f" · 两组均触及关键风险 {counts.get('both_unacceptable', 0)}。"
        f"平均得分：无经验 {primary['arms']['baseline']['meanTotalOutOf8']:.2f}/8"
        f" → 加载经验 {primary['arms']['shared']['meanTotalOutOf8']:.2f}/8。"
        f"另有 2 个案例独立重跑，{sum(r['sameDirection'] for r in result['stability'])}/2 对比方向一致。"
    )
    document = f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>饮食推荐两组对照</title><style>{css}</style><main><h1>饮食推荐：无经验与加载经验</h1><p>先看建议改变了什么，再看是否更好。原始回答不改写；分值来自预先冻结的案例规则，不是临床准确率。</p><p class="summary">{summary}</p><nav>{nav}</nav>{"".join(sections)}</main></html>'
    (directory / "comparison.html").write_text(document)
