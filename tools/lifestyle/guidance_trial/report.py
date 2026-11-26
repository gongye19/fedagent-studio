"""仅本地实验报告；保留完整回答/评分，不挑选提升案例。"""

import html

from ..batch.evaluate import summarize
from ..batch.report import plot
from ..common import load, save


def report(directory, plan, library, results, spent):
    summary = summarize(results)
    attempts = [
        r for path in directory.glob("meter-*/attempts.json") for r in load(path)
    ]
    value = {
        "protocol": plan["protocol"],
        "fingerprint": plan["fingerprint"],
        "model": plan["identity"]["model"],
        "summary": summary,
        "results": results,
        "sourceUsage": library["sourceUsage"],
        "experienceCards": len(library["cards"]),
        "aggregationGroups": len(library["groups"]),
        "libraryDigest": library["digest"],
        "calls": spent,
        "normalCalls": plan["normalCalls"],
        "callStatuses": {
            s: sum(r["status"] == s for r in attempts)
            for s in ("ok", "error", "started")
        },
        "usage": {
            k: sum(r.get("usage", {}).get(k, 0) for r in attempts)
            for k in ("prompt_tokens", "completion_tokens")
        },
        "limitations": [
            "LifeStyle领域适配版，非原FoT提示/聚合原样复现；词项选择至多8卡。",
            "公开指导解释，不是真实个人干预成功经验。引用与结构校验不等于医学语义审核。",
            "24题固定主题子集、同模型逐规则自评；不是官方全量成绩或健康获益证明。",
            "来源日期/国家不同；未部署、未接LifeStyle App。",
        ],
    }
    save(directory / "report.json", value)
    plot(directory, summary)
    baseline = summary["arms"]["without"]["rawMacroScore"]
    shared = summary["arms"]["shared"]["rawMacroScore"]
    delta = summary["comparison"]["deltaPoints"]
    lines = [
        "# 四来源LifeStyle推荐实验",
        "",
        f"方法：{plan['protocol']}（FoT领域适配；非原算法原样复现）",
        "",
        f"资料：{sum(library['sourceUsage'].values())}条；具体经验卡：{len(library['cards'])}张；引用聚合组：{len(library['groups'])}组。",
        "",
        f"完整对照：{summary['completePairedCases']}/{summary['cases']}题。",
        "",
        f"无经验 {baseline:.2%}；加载经验 {shared:.2%}；差值 {delta:+.2f} 个百分点。",
        "",
        f"变好{summary['comparison']['better']}，持平{summary['comparison']['same']}，变差{summary['comparison']['worse']}。",
        "",
        f"实际模型尝试{spent}次；所有原始回答、经验选择和逐条评分见report.json与report.html。",
        "",
        *value["limitations"],
    ]
    (directory / "result-summary.md").write_text("\n".join(lines) + "\n")
    esc = lambda x: html.escape(str(x))
    cases = []
    for row in results:
        parts = []
        for arm, label in (("without", "无经验"), ("shared", "加载经验")):
            item = row["arms"][arm]
            parts.append(
                f"<article><h3>{label} · {item['score']:.1%}</h3><p>{esc(item['answer'])}</p></article>"
            )
        rules = [
            {"criterion": r, "without": a, "shared": b}
            for r, a, b in zip(
                row["rubrics"],
                row["arms"]["without"]["grades"],
                row["arms"]["shared"]["grades"],
                strict=True,
            )
        ]
        cases.append(
            f"<details><summary>{esc(row['question'])}</summary><div class='pair'>{''.join(parts)}</div><details><summary>逐条评分</summary><pre>{esc(rules)}</pre></details></details>"
        )
    (directory / "report.html").write_text(
        "<!doctype html><html lang='zh-CN'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>四来源推荐实验</title><style>body{font:16px/1.7 system-ui;max-width:1200px;margin:32px auto;padding:0 20px;color:#202124}"
        ".pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}article,details{border:1px solid #ddd;border-radius:10px;padding:16px;margin:12px 0}"
        "p,pre{white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer}img{max-width:100%}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style>"
        f"<h1>四来源LifeStyle推荐实验</h1><p>无经验 {baseline:.2%} → 加载经验 {shared:.2%}，{delta:+.2f} 个百分点；{len(results)}题。</p>"
        f"<p>{esc('；'.join(value['limitations']))}</p><img src='comparison.png' alt='两组评分对比'>{''.join(cases)}</html>"
    )
    return value
