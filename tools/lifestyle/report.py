"""可离线查看的对照报告：总览图与逐题展开，不把模型评分称为临床正确率。"""

from __future__ import annotations

import html
from pathlib import Path

from .common import load, save
from .evaluate import ARMS, summarize

LABELS = {"without": "无经验", "local": "本站经验", "shared": "三方经验"}


def report(directory: Path, manifest, state, shared, results, model):
    summary = summarize(results)
    attempts = load(directory / "attempts.json") if (directory / "attempts.json").exists() else []
    usage = {key: sum(c.get("usage", {}).get(key, 0) for c in attempts) for key in ("prompt_tokens", "completion_tokens")}
    value = {
        "protocol": manifest["protocol"],
        "model": model.name,
        "summary": summary,
        "results": results,
        "taskId": state["taskId"],
        "appId": state["appId"],
        "sharedEntries": len(shared),
        "localEntries": {site: len(content) for site, content in state["local"].items()},
        "remoteCalls": len(attempts),
        "reportedModels": sorted({c["reportedModel"] for c in attempts if c.get("reportedModel")}),
        "usage": usage,
        "price": None,
        "limitations": [
            "公开知识和合成用户，模拟三个来源方；不是三家真实医院。",
            "仅三个留出问题的链路测试，不能证明健康收益或统计显著提升。",
            "同一固定模型作为作答者与独立请求的盲评者，仍存在模型自评偏差；没有医生复核。",
            "训练／留出画像与来源文档不同，概念可能相关，未保证语义完全隔离。",
            "原有 FoT 反思、最多三条经验、归类、paper-auto 生成；建议任务和应用提示词是领域适配。",
            "本机模型桥与远端网关均关闭失败自动重试；合法性修正仍计入最多 50 次调用预算。",
            "服务器仅新增正常模型审计记录；任务、资源、经验包与评测均在本机。",
        ],
    }
    save(directory / "report.json", value)

    def escape(text):
        return html.escape(str(text))

    sections = []
    for row in results:
        sides = []
        for arm in ARMS:
            result = row["arms"][arm]
            assessment = result.get("assessment")
            grade = f"{assessment['score']:.0%} · {assessment['unsafe']} 项安全规则未满足" if assessment else "未完成，未计分"
            criteria = "".join(f"<li>{'✓' if item['met'] else '✗'} {escape(item['reason'])}</li>" for item in (assessment or {}).get("items", []))
            sides.append(
                f"<article><h3>{LABELS[arm]}</h3><strong>{grade}</strong><p>{escape(result.get('answer', '尚无回答'))}</p><ul>{criteria}</ul></article>"
            )
        sections.append(
            f"<details><summary>站点 {row['site']} · {escape(row['input']['question'])}</summary>"
            f'<p>{escape(row["input"]["profile"])}</p><div class="grid">{"".join(sides)}</div></details>'
        )
    bars = "".join(
        f'<div class="bar-row"><span>{LABELS[arm]}</span><div class="track"><div style="width:{(summary["arms"][arm]["score"] or 0) * 100}%"></div></div>'
        f"<b>{summary['arms'][arm]['score']:.0%}</b></div>"
        if summary["arms"][arm]["score"] is not None
        else f"<p>{LABELS[arm]}：没有完整的配对案例</p>"
        for arm in ARMS
    )
    completed_text = f"完整配对 {summary['completePairedCases']} / {summary['cases']}；不完整 {summary['incompleteCases']}。三方经验 {len(shared)} 条。"
    page = f"""<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LifeStyle 本地对照</title><style>
*{{box-sizing:border-box}}body{{font:15px/1.7 system-ui,sans-serif;color:#19212c;background:#f6f7fa;margin:0}}
main{{max-width:1200px;margin:auto;padding:32px 24px}}h1{{font-size:26px}}h2{{font-size:19px}}h3{{margin:0 0 8px}}
section,details{{background:white;border:1px solid #dce1e8;border-radius:12px;padding:24px;margin:16px 0}}
.grid{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}}
article{{min-width:0}}
article+article{{border-left:1px solid #e5e7eb;padding-left:24px}}
p{{white-space:pre-wrap;overflow-wrap:anywhere}}summary{{cursor:pointer;font-weight:600}}li{{margin:8px 0}}.muted{{color:#626d7c}}
.bar-row{{display:grid;grid-template-columns:90px 1fr 60px;gap:16px;align-items:center;margin:16px 0}}
.track{{background:#edf0f5;height:18px;border-radius:4px;overflow:hidden}}
.track>div{{background:#2860e6;height:100%}}
b{{text-align:right}}
@media(max-width:800px){{.grid{{grid-template-columns:1fr}}
article+article{{border-left:0;border-top:1px solid #e5e7eb;padding:20px 0 0}}}}
</style><main><h1>LifeStyle · 本地三方对照</h1><p class="muted">{escape(model.name)} · {len(results)} 个留出问题 · 模型逐项评分</p>
<section><h2>建议规则满足率</h2>{bars}<p>{completed_text}</p></section>
{"".join(sections)}<section><h2>本次测试范围</h2><ul>{"".join("<li>" + escape(x) + "</li>" for x in value["limitations"])}</ul>
<p>{len(attempts)} 次远程调用；输入 {usage["prompt_tokens"]} / 输出 {usage["completion_tokens"]} token。
未配置单价，不估算实付费用。</p></section></main></html>"""
    (directory / "report.html").write_text(page)
    return value
