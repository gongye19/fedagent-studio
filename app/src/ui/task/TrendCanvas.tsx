import { useEffect, useRef } from "react";
import { init, use as register, type EChartsCoreOption } from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { trendData } from "./trend";

register([LineChart, GridComponent, TooltipComponent, SVGRenderer]);
type Data = ReturnType<typeof trendData>;

export default function TrendCanvas({ data, selected }: { data: Data; selected: string[] }) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<ReturnType<typeof init> | null>(null);
  useEffect(() => {
    const node = host.current!;
    const chart = init(node, undefined, { renderer: "svg" });
    instance.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(node);
    return () => { observer.disconnect(); chart.dispose(); instance.current = null; };
  }, []);
  useEffect(() => {
    const visible = data.series.filter((s) => selected.includes(s.id));
    const option: EChartsCoreOption = {
      animation: false,
      grid: { top: 20, left: 44, right: 22, bottom: 34 },
      tooltip: {
        trigger: "axis", renderMode: "richText", confine: true,
        formatter: (params: { dataIndex: number }[]) => {
          const index = params[0]?.dataIndex ?? 0;
          return [`第 ${index + 1} 轮${index ? "" : " · 本地基线"}`, ...visible.map((s) => {
            const v = s.values[index];
            return `${s.name.replace(/[{}]/g, "")}  ${v == null ? "—" : `${(v * 100).toFixed(1)}%`} · ${s.counts[index]}`;
          })].join("\n");
        },
      },
      xAxis: { type: "category", data: data.rounds.map((r) => `第${r}轮`), boundaryGap: true, axisTick: { show: false }, axisLine: { lineStyle: { color: "#d9dee7" } }, axisLabel: { color: "#687386", hideOverlap: true } },
      yAxis: { type: "value", min: 0, max: 100, interval: 25, axisLabel: { formatter: "{value}%", color: "#687386" }, splitLine: { lineStyle: { color: "#edf0f5" } } },
      series: visible.map((s) => ({
        id: s.id, name: s.name, type: "line", smooth: false, connectNulls: false, showSymbol: true,
        symbol: s.id === "average" ? "diamond" : "circle", symbolSize: s.id === "average" ? 9 : 7,
        lineStyle: { width: s.id === "average" ? 3 : 2 }, itemStyle: { color: s.color },
        data: s.values.map((v) => v === null ? null : Number((v * 100).toFixed(3))),
      })),
    };
    instance.current?.setOption(option, { notMerge: true });
  }, [data, selected]);
  return <div className="trend-canvas" ref={host} aria-hidden="true" />;
}
