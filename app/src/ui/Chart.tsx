/**
 * ECharts 的薄封装：按需引入条形图和散点图（用来画"第 1 轮 → 最后一轮"的哑铃图），SVG 渲染，随容器宽度自适应。
 */
import { useEffect, useRef } from "react";
import { BarChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";

echarts.use([BarChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

export type ChartOption = echarts.EChartsCoreOption;

export default function EChart({ option, height, label }: { option: ChartOption; height: number; label: string }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    const instance = echarts.init(element, undefined, { renderer: "svg" });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={container} className="chart" style={{ height }} role="img" aria-label={label} />;
}
