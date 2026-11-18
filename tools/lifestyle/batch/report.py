"""离线科学图及可展开的完整评测报告，不连接模型。"""

from __future__ import annotations

import html
from pathlib import Path
from string import Template

from ..common import digest, load, rows, save
from .evaluate import ARMS, summarize

LABELS = {"without": "无经验", "shared": "FoT 联邦经验"}


def results_from_disk(directory):
    results = []
    refs = {r["id"]: r["rubrics"] for r in rows(directory / "inputs/evaluation-references.jsonl")}
    for case in rows(directory / "inputs/evaluation-inputs.jsonl"):
        path = directory / "evaluation" / (case["id"].removeprefix("healthbench:") + ".json")
        if path.exists():
            result = load(path)
            if digest({k: v for k, v in result.items() if k != "resultDigest"}) != result.get("resultDigest"):
                raise ValueError("evaluation-projection-corrupted; rebuild from unit checkpoints with run")
        else:
            result = {**case, "rubrics": refs[case["id"]], "arms": {a: {"status": "missing"} for a in ARMS}}
        results.append(result)
    return results


def plot(directory, summary):
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib import pyplot as plt

    values = [summary["arms"][a]["rawMacroScore"] for a in ARMS]
    fig, ax = plt.subplots(figsize=(6.8, 4.4), layout="constrained")
    for index, (value, color) in enumerate(zip(values, ("#8793a5", "#2563eb"), strict=True)):
        if value is not None:
            ax.bar(index, 100 * value, width=0.5, color=color)
            ax.annotate(f"{value:.1%}", (index, 100 * value), xytext=(0, 6 if value >= 0 else -18), textcoords="offset points", ha="center")
        else:
            ax.text(index, 0.05, "Not complete", ha="center", transform=ax.get_xaxis_transform())
    actual = [100 * v for v in values if v is not None]
    ax.set_ylim(min([0, *actual]) - (10 if any(v < 0 for v in actual) else 0), max([100, *actual]) + 10)
    ax.set_xticks([0, 1], ["Without experience", "Federated FoT"])
    ax.set_ylabel("HealthBench rubric score (%)")
    ax.set_title(f"LifeStyle: {summary['completePairedCases']}/{summary['cases']} paired cases")
    ax.axhline(0, color="#d1d5db", linewidth=0.8)
    ax.spines[["top", "right"]].set_visible(False)
    ax.set_axisbelow(True)
    ax.yaxis.grid(True, color="#e5e7eb", linewidth=0.7)
    fig.savefig(directory / "comparison.svg")
    fig.savefig(directory / "comparison.png", dpi=160)
    plt.close(fig)


def report(directory):
    results = results_from_disk(directory)
    summary = summarize(results)
    manifest = load(directory / "inputs/prepared.json")
    state = load(directory / "run.json") if (directory / "run.json").exists() else {}
    task = load(directory / "task.json") if (directory / "task.json").exists() else {}
    attempts = load(directory / "attempts.json") if (directory / "attempts.json").exists() else []
    library = load(directory / "shared-library.json") if (directory / "shared-library.json").exists() else {}
    if library and digest(library) != task.get("libraryDigest"):
        raise ValueError("published-library-corrupted")
    value = {
        "protocol": manifest["protocol"],
        "summary": summary,
        "results": results,
        "run": state,
        "task": task,
        "model": load(directory / "model.json") if (directory / "model.json").exists() else {"model": manifest["modelRef"]},
        "experienceEntries": len(library),
        "generatedProcesses": sum("value" in load(p) for p in (directory / "generated").glob("*.json")),
        "sourceDocumentsPlanned": len(manifest.get("training", [])),
        "reportedModels": sorted({c["reportedModel"] for c in attempts if c.get("reportedModel")}),
        "remoteAttempts": len(attempts),
        "callLimit": manifest["callLimit"],
        "callStatuses": {s: sum(c["status"] == s for c in attempts) for s in ("ok", "error", "started")},
        "usage": {k: sum(c.get("usage", {}).get(k, 0) for c in attempts) for k in ("prompt_tokens", "completion_tokens")},
        "largestRequestBound": max(
            (c.get("context", {}).get("inputUtf8Bytes", 0) + c.get("context", {}).get("outputTokenCap", 0) for c in attempts), default=0
        ),
        "limitations": [
            "公开机构资料和模型生成过程；NIH／CDC／NHS是模拟来源组，不是三家医院或私人报告。",
            "24题主题子集、同一模型自评，无医生复核；评分不是临床正确率，不证明健康获益。",
            "保留原始多轮对话、评分提示与正负权重；作答采用独立对话适配器，并非中文应用入口的逐字复现。",
            "逐项分数可为负；另给原版方式裁剪至0–1的均值。主图和提升使用未裁剪的配对均分。",
            "评分使用当前模型、temperature=0、最多两次格式尝试且要求非空解释；这些与官方默认评测不同。",
            "原文有地区和版本差异，不能自动合并成通用标准；经验不等于权威证据。",
            "完整任务后才检查每条1–3个trace，零trace失败仍已花费归类／建库调用；此时不发布。",
            "FoT格式暂停为终态；相同请求缓存可能使插件重试复用同一错误回复，报告不把它算成新生成。",
            "850次含失败／修正，先为730次评测留预算；不自动增加限额。远程尝试数不等同供应商HTTP账单次数。",
            "上下文仅用UTF8字节加输出上限作保守边界；没有宣称已核实供应商模型窗口。",
            "未部署；任务、数据和成果仅本机，远端只追加正常模型调用审计。",
        ],
    }
    save(directory / "report.json", value)
    plot(directory, summary)

    def esc(value):
        return html.escape(str(value))

    cases = []
    for row in results:
        paired = all(row["arms"].get(a, {}).get("status") == "complete" for a in ARMS)
        delta = row["arms"]["shared"]["score"] - row["arms"]["without"]["score"] if paired else None
        group = "missing" if delta is None else "better" if delta > 1e-12 else "worse" if delta < -1e-12 else "same"
        label = {"better": "变好", "worse": "变差", "same": "持平", "missing": "未完成"}[group]
        sides = []
        for arm in ARMS:
            item = row["arms"].get(arm, {})
            score_text = f"{item['score']:.1%}" if item.get("score") is not None else "未完成"
            sides.append(f"<article><h3>{LABELS[arm]} <span>{score_text}</span></h3><p>{esc(item.get('answer', '尚无回答'))}</p></article>")
        rules = []
        for index, rubric in enumerate(row["rubrics"]):
            cells = []
            for arm in ARMS:
                grades = row["arms"].get(arm, {}).get("grades", [])
                grade = grades[index] if index < len(grades) else None
                cells.append("<td>" + (("满足" if grade["criteria_met"] else "不满足") + "<br>" + esc(grade["explanation"]) if grade else "未评") + "</td>")
            rules.append(f"<tr><th>{esc(rubric['points'])} · {esc(rubric['criterion'])}</th>{''.join(cells)}</tr>")
        cases.append(
            f"<details class='case' data-group='{group}'><summary><span>{esc(row['question'])}</span><b>{label}</b></summary>"
            f"<div class='sides'>{''.join(sides)}</div><details class='rules'><summary>逐项评分依据</summary><div class='table-scroll'><table>"
            f"<thead><tr><th>原始权重与规则</th><th>无经验</th><th>FoT经验</th></tr></thead><tbody>{''.join(rules)}</tbody></table></div></details></details>"
        )
    comparison = summary["comparison"]
    delta_text = f"{comparison['deltaPoints']:+.1f} 个百分点" if comparison["deltaPoints"] is not None else "等待完整配对"
    assets = Path(__file__).parent
    page = Template((assets / "report-template.html").read_text()).substitute(
        STYLE=(assets / "report.css").read_text(),
        SCRIPT=(assets / "report.js").read_text(),
        MODEL=esc(value["model"]["model"]),
        ENTRIES=len(library),
        DOCUMENTS=value["sourceDocumentsPlanned"],
        PROCESSES=value["generatedProcesses"],
        DELTA=delta_text,
        BETTER=comparison["better"],
        SAME=comparison["same"],
        WORSE=comparison["worse"],
        PAIRED=summary["completePairedCases"],
        TOTAL=summary["cases"],
        MISSING=summary["incompleteCases"],
        CASES="".join(cases),
        ATTEMPTS=len(attempts),
        LIMIT=manifest["callLimit"],
        INPUT_TOKENS=f"{value['usage']['prompt_tokens']:,}",
        OUTPUT_TOKENS=f"{value['usage']['completion_tokens']:,}",
        STATUS=esc(state.get("status", "prepared")),
        ERROR=esc(state.get("error", "")),
        LIMITATIONS="".join("<li>" + esc(s) + "</li>" for s in value["limitations"]),
    )
    (directory / "report.html").write_text(page)
    return value
