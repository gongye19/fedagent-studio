import { lazy, Suspense, useMemo } from "react";
import type { Task } from "../../domain/task";
import { trendData } from "./trend";

const TrendCanvas = lazy(() => import("./TrendCanvas"));

export function MetricComparison({ task }: { task: Task; latest?: number }) {
  const data = useMemo(() => trendData(task), [task]);
  return <div className="metric-trend">
    <ul className="trend-legend" aria-label="参与方图例">
      {data.series.map((s) => <li key={s.id}><span style={{ background: s.color }} aria-hidden="true" />{s.name}</li>)}
    </ul>
    <Suspense fallback={<div className="trend-canvas section-meta">正在加载图表…</div>}><TrendCanvas data={data} /></Suspense>
    <p className="trend-caption">{data.comparison ? "同一批独立病例 · 三组对照" : "第 1 轮：本地基线"}<span>精确结果见下方明细</span></p>
  </div>;
}
