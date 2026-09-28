import { lazy, Suspense, useMemo } from "react";
import {
  accuracy,
  averageAccuracy,
  changeOf,
  libraries,
  negativeTransfer,
  roundOf,
  scoredRounds,
  totalTokens,
  type Task,
} from "../../domain/task";
import type { ChartOption } from "../Chart";
import { EmptyState, Kpi, Panel, SampleNote } from "../common";
import { formatDelta, formatPercent, formatTokens } from "../format";
import { deltaClass, roundHeader, roundLabel } from "../labels";

// 图表库较大，按需加载，不拖慢首屏。
const EChart = lazy(() => import("../Chart"));

/** 参与方折线用一组克制的颜色；平均值用正文色加粗。 */
const SERIES_COLORS = ["#2563eb", "#0e7490", "#15803d", "#a16207", "#c2410c", "#be185d", "#6d28d9", "#475569"];

const FONT = "Geist Sans, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif";

export function ResultsTab({ task }: { task: Task }) {
  const rounds = scoredRounds(task);
  if (!rounds.length) {
    return <EmptyState title="还没有结果">第 1 轮解题完成后，这里会显示各参与方的准确率。</EmptyState>;
  }
  const latest = rounds[rounds.length - 1];
  const first = averageAccuracy(task, 1);
  const last = averageAccuracy(task, latest);
  const delta = latest > 1 && first !== null && last !== null ? last - first : null;
  const ntr = negativeTransfer(task);
  const library = libraries(task).at(-1);

  return (
    <div className="stack">
      <SampleNote />
      <dl className="kpi-row">
        <Kpi label="平均准确率" value={formatPercent(last)} sub={latest > 1 ? `第 1 轮为 ${formatPercent(first)}` : "第 1 轮（本地基线）"} />
        <Kpi label="相对第 1 轮" value={formatDelta(delta)} tone={delta === null ? undefined : delta < 0 ? "down" : "up"} sub={`第 ${latest} 轮 vs 第 1 轮，各方平均`} />
        <Kpi label="负迁移" value={ntr ? `${ntr.count} / ${ntr.total} 方` : "—"} sub="最新一轮低于本方第 1 轮" tone={ntr && ntr.count > 0 ? "down" : undefined} />
        <Kpi label="洞见库" value={library ? `${library.insights.length} 条` : "—"} sub={library ? `第 ${library.builtAfterRound} 轮后生成` : "第 1 轮结束后生成"} />
        <Kpi label="token 用量" value={formatTokens(totalTokens(task))} sub="已完成的轮次" />
      </dl>

      <Panel title="每轮准确率" id="accuracy">
        <AccuracyChart task={task} />
      </Panel>

      <Panel title="本地 vs 联邦" id="comparison" flush extra={<small className="muted">第 1 轮没有洞见库，各方单独作答；变化以百分点计</small>}>
        <ComparisonTable task={task} />
      </Panel>
    </div>
  );
}

function AccuracyChart({ task }: { task: Task }) {
  const option = useMemo<ChartOption>(() => {
    const rounds = Array.from({ length: task.config.rounds }, (_, index) => index + 1);
    const percent = (value: number | null) => (value === null ? null : Number((value * 100).toFixed(1)));
    const members = task.members.filter((member) => member.answered > 0);
    return {
      textStyle: { fontFamily: FONT },
      grid: { left: 48, right: 20, top: 16, bottom: 72 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value: unknown) => (typeof value === "number" ? `${value}%` : "—"),
      },
      legend: {
        bottom: 0,
        type: "scroll",
        icon: "roundRect",
        itemWidth: 14,
        itemHeight: 4,
        textStyle: { color: "#52525b", fontSize: 12 },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: rounds.map(roundLabel),
        axisLine: { lineStyle: { color: "#d4d4d8" } },
        axisTick: { show: false },
        axisLabel: { color: "#52525b", fontSize: 12 },
      },
      yAxis: {
        type: "value",
        min: (extent: { min: number }) => Math.max(0, Math.floor(extent.min / 10) * 10 - 10),
        max: (extent: { max: number }) => Math.min(100, Math.ceil(extent.max / 10) * 10 + 10),
        axisLabel: { formatter: "{value}%", color: "#71717a", fontSize: 12 },
        splitLine: { lineStyle: { color: "#f0f0f2" } },
      },
      series: [
        ...members.map((member, index) => ({
          name: member.participant,
          type: "line",
          data: rounds.map((round) => percent(accuracy(task, member, round))),
          color: SERIES_COLORS[index % SERIES_COLORS.length],
          symbolSize: 5,
          lineStyle: { width: 1.5 },
          emphasis: { focus: "series" },
        })),
        {
          name: "平均",
          type: "line",
          data: rounds.map((round) => percent(averageAccuracy(task, round))),
          color: "#18181b",
          symbolSize: 7,
          lineStyle: { width: 3 },
          z: 10,
          emphasis: { focus: "series" },
        },
      ],
    };
  }, [task]);

  return (
    <Suspense fallback={<div className="chart chart--loading" style={{ height: 320 }}>正在加载图表…</div>}>
      <EChart option={option} height={320} label="每轮准确率：各参与方和平均值" />
    </Suspense>
  );
}

function ComparisonTable({ task }: { task: Task }) {
  const rounds = Array.from({ length: task.config.rounds }, (_, index) => index + 1);
  // 窄屏只保留第 1 轮、最后一轮和变化，中间轮次收起。
  const middle = (round: number) => round !== 1 && round !== rounds.length;
  const first = averageAccuracy(task, 1);
  const latestAverage = [...rounds].reverse().map((round) => averageAccuracy(task, round)).find((value) => value !== null) ?? null;
  const averageDelta = scoredRounds(task).length > 1 && first !== null && latestAverage !== null ? latestAverage - first : null;

  return (
    <div className="table-wrap">
      <table className="table table--numbers">
        <thead>
          <tr>
            <th scope="col">参与方</th>
            <th scope="col" className="numeric col-optional">题数</th>
            {rounds.map((round) => {
              const header = roundHeader(round);
              return (
                <th key={round} scope="col" className={`numeric${middle(round) ? " col-optional" : ""}`}>
                  {header.main}{header.note ? <span className="wide-only">{header.note}</span> : null}
                </th>
              );
            })}
            <th scope="col" className="numeric">变化</th>
          </tr>
        </thead>
        <tbody>
          {task.members.map((member) => {
            const change = changeOf(task, member);
            return (
              <tr key={member.datasetId}>
                <th scope="row">
                  {member.participant}
                  {member.dataset !== member.participant ? <small>{member.dataset}</small> : null}
                </th>
                <td className="numeric col-optional">{member.problems}</td>
                {rounds.map((round) => {
                  const value = accuracy(task, member, round);
                  const correct = roundOf(task, round)?.correct?.[member.datasetId];
                  return (
                    <td key={round} className={`numeric${middle(round) ? " col-optional" : ""}`}>
                      {member.answered === 0 ? <span className="muted">无答案</span> : formatPercent(value)}
                      {correct !== undefined ? <small>{correct} / {member.answered}</small> : null}
                    </td>
                  );
                })}
                <td className={`numeric ${deltaClass(change)}`}>{formatDelta(change, { compact: true })}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">平均</th>
            <td className="numeric col-optional">—</td>
            {rounds.map((round) => <td key={round} className={`numeric${middle(round) ? " col-optional" : ""}`}>{formatPercent(averageAccuracy(task, round))}</td>)}
            <td className={`numeric ${deltaClass(averageDelta)}`}>{formatDelta(averageDelta, { compact: true })}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
