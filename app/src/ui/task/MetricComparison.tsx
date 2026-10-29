import { lazy, Suspense, useMemo, useState } from "react";
import type { Task } from "../../domain/task";
import { InfoTip } from "../InfoTip";
import { trendData } from "./trend";

const TrendCanvas = lazy(() => import("./TrendCanvas"));

export function MetricComparison({ task }: { task: Task; latest?: number }) {
  const data = useMemo(() => trendData(task), [task]);
  const [chosen, setChosen] = useState<string[]>(["average"]);
  const selected = chosen.filter((id) => data.series.some((s) => s.id === id));
  return <div className="metric-trend">
    <div className="trend-legend" aria-label="选择显示的参与方">
      {data.series.map((s) => <button key={s.id} type="button" aria-pressed={selected.includes(s.id)}
        onClick={() => setChosen((prev) => prev.includes(s.id) ? prev.filter((id) => id !== s.id) : [...prev, s.id])}>
        <span style={{ background: s.color }} aria-hidden="true" />{s.name}
      </button>)}
      <InfoTip label="趋势图">{data.comparison ? "三组使用相同独立评测病例，只改变经验来源。" : "第1轮是本地基线。"}点图例查看各方；未完成评测不绘制分数，精确结果见下方明细。</InfoTip>
    </div>
    {selected.length ? <Suspense fallback={<div className="trend-canvas section-meta">正在加载趋势图…</div>}><TrendCanvas data={data} selected={selected} /></Suspense>
      : <div className="trend-canvas section-empty">点击上方图例，选择要查看的参与方</div>}
    <p className="trend-caption">{data.comparison ? "三组对照 · 各方等权平均" : "第 1 轮：本地基线"}<span>精确结果见下方明细</span></p>
  </div>;
}
