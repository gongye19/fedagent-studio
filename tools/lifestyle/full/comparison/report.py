"""仅根据实际配对分数生成图表、CSV与完整结果，不读取模型配置。"""

import csv
import html

from ...batch.evaluate import summarize
from ...batch.report import results_from_disk
from ...common import load, save

LIMITATIONS = [
    "5个独立FoT经验包共同加载；经验正文未改，键加批次前缀，重叠内容没有去重，也没有额外聚合。",
    "此集合不是原版FoT一次处理444条的统一经验库；公开资料来源不代表五个医院或不同domain。",
    "完整经验集合直接进入系统提示，与平台应用默认选取少量经验的方式不同。",
    "24题曾用于旧实验，是独立于学习记录的固定回归题集，并非全新未见评测；本轮重新生成无经验回答。",
    "同模型自评的HealthBench规则满足分不是诊断正确率或临床收益；保留原正负权重，缺失不算答错。",
    "只有两组均完整的病例纳入配对均分；完整结果须24对，不能把部分配对结果当全量结论。",
    "850次含失败与格式修正，独立于生成及提取1500次上限；远程尝试不等同供应商实际账单。未部署。",
]


def report(directory, plan, state):
    results = results_from_disk(directory)
    summary = summarize(results)
    attempts = load(directory / "attempts.json") if (directory / "attempts.json").exists() else []
    value = {
        "protocol": plan["protocol"],
        "run": state,
        "summary": summary,
        "origins": plan["origins"],
        "sourceCounts": plan["sourceCounts"],
        "experienceEntries": sum(v["entries"] for v in plan["origins"]),
        "remoteAttempts": len(attempts),
        "callLimit": 850,
        "usage": {k: sum(r.get("usage", {}).get(k, 0) for r in attempts) for k in ("prompt_tokens", "completion_tokens")},
        "results": results,
        "limitations": LIMITATIONS,
    }
    save(directory / "report.json", value)
    with (directory / "cases.csv").open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.writer(file)
        writer.writerow(["题目", "无经验原始分", "五包共同加载原始分", "变化（百分点）", "配对状态"])
        for row in results:
            a, b = row["arms"]["without"].get("score"), row["arms"]["shared"].get("score")
            paired = all(row["arms"][arm].get("status") == "complete" for arm in ("without", "shared"))
            writer.writerow([row["id"], a, b, 100 * (b - a) if paired else "", "完成" if paired else "未完成"])
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib import pyplot as plt

    fig, ax = plt.subplots(figsize=(7.5, 4.5), layout="constrained")
    for index, arm in enumerate(("without", "shared")):
        score = summary["arms"][arm]["rawMacroScore"]
        if score is not None:
            ax.bar(index, score * 100, width=0.5, color=("#8793a5", "#2563eb")[index])
            ax.annotate(f"{score:.1%}", (index, score * 100), xytext=(0, 6), textcoords="offset points", ha="center")
    ax.set_xticks([0, 1], ["No experience", "All 5 FoT packages\n(no extra aggregation)"])
    ax.set_ylabel("HealthBench rubric score (%)")
    ax.set_title(f"LifeStyle: {summary['completePairedCases']}/{summary['cases']} paired cases")
    ax.spines[["top", "right"]].set_visible(False)
    ax.axhline(0, color="#d1d5db")
    fig.savefig(directory / "comparison.png", dpi=160)
    fig.savefig(directory / "comparison.svg")
    plt.close(fig)
    comparison = summary["comparison"]
    scores = [("无经验 · 规则满足分", summary["arms"]["without"]["rawMacroScore"]), ("全部经验 · 规则满足分", summary["arms"]["shared"]["rawMacroScore"])]
    metrics = "".join(
        f"<div><dt>{label}</dt><dd>{score:.1%}</dd></div>" if score is not None else f"<div><dt>{label}</dt><dd>待完成配对</dd></div>"
        for label, score in scores
    )
    delta = comparison["deltaPoints"]
    delta_text = f"{delta:+.1f} 个百分点" if delta is not None else "待完成配对"
    metrics += f"<div><dt>变化</dt><dd>{delta_text}</dd></div>"
    details = []
    for row in results:
        columns = "".join(
            f"<article><h3>{label}</h3><p>{html.escape(row['arms'][arm].get('answer', '未完成'))}</p></article>"
            for arm, label in (("without", "无经验"), ("shared", "五包共同加载"))
        )
        details.append(f"<details><summary>{html.escape(row['question'])}</summary><div class='answers'>{columns}</div></details>")
    text = """<!doctype html><html lang='zh-CN'><meta charset='utf-8'>
<meta name='viewport' content='width=device-width,initial-scale=1'><title>LifeStyle 两组评测</title>
<style>body{font:16px/1.65 system-ui,sans-serif;max-width:1080px;margin:32px auto;padding:0 20px;color:#202124}
dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:24px 0}dt{font-size:14px;color:#666}
dd{margin:4px 0 0;font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}
img{max-width:100%;height:auto}.answers{display:grid;grid-template-columns:1fr 1fr;gap:24px}
details{border-top:1px solid #ddd;padding:16px 0}summary{cursor:pointer}p{white-space:pre-wrap;overflow-wrap:anywhere}
pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:700px){.answers,dl{grid-template-columns:1fr}}</style>
<h1>LifeStyle：无经验与五包共同加载</h1>"""
    text += (
        f"<p>状态：{html.escape(state['status'])} · 完成配对：{summary['completePairedCases']}/{summary['cases']} · 调用：{len(attempts)}/850</p>"
        f"<dl>{metrics}</dl><p>变好 {comparison['better']} · 持平 {comparison['same']} · 变差 {comparison['worse']}</p>"
        "<img src='comparison.svg' alt='两组规则满足分对比'>"
        "<p><a href='cases.csv'>逐题分数 CSV</a> · <a href='report.json'>完整回答与逐项评分 JSON</a></p>"
    )
    text += "<ul>" + "".join("<li>" + html.escape(v) + "</li>" for v in LIMITATIONS) + "</ul>" + "".join(details) + "</html>"
    (directory / "report.html").write_text(text)
    return value
