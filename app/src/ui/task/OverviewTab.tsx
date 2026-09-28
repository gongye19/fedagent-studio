import { lazy, Suspense, useMemo } from "react";
import {
  accuracy,
  averageAccuracy,
  changeOf,
  latestScoredRound,
  libraries,
  negativeTransfer,
  roundOf,
  scoredRounds,
  type Task,
} from "../../domain/task";
import type { ChartOption } from "../Chart";
import { EmptyState, Stat } from "../common";
import { Panel } from "../console";
import { formatDelta, formatPercent } from "../format";
import { algorithmOfTask, deltaClass, metricOf, roundHeader } from "../labels";

// 图表库较大，按需加载，不拖慢首屏。
const EChart = lazy(() => import("../Chart"));

const FONT = "Geist Sans, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif";
// 点只分"第 1 轮 / 最新一轮"两种颜色，和图例一致；涨跌只看连线：绿色表示变好，红色表示变差。
const COLORS = { base: "#a1a1aa", latest: "#18181b", flat: "#71717a", upLine: "#4ade80", downLine: "#f87171" };

export function OverviewTab({ task }: { task: Task }) {
  const rounds = scoredRounds(task);
  const metric = metricOf(task);
  const output = algorithmOfTask(task).output;
  if (!rounds.length) {
    return <EmptyState title="还没有结果"><p>第 1 轮完成后，这里显示各参与方的{metric}。</p></EmptyState>;
  }
  const latest = rounds[rounds.length - 1];
  const first = averageAccuracy(task, 1);
  const last = averageAccuracy(task, latest);
  const delta = latest > 1 && first !== null && last !== null ? last - first : null;
  const ntr = negativeTransfer(task);
  const library = libraries(task).at(-1);

  return (
    <div className="panel-stack">
      <Panel title={`${metric}：本地 vs 联邦`}>
        <dl className="stats">
          <Stat label="本地（第 1 轮）" value={formatPercent(first)} sub="各方单独作答" />
          <Stat
            label={latest > 1 ? `联邦（第 ${latest} 轮）` : "联邦"}
            value={latest > 1 ? formatPercent(last) : "—"}
            sub={latest > 1 ? <span className={deltaClass(delta)}>{formatDelta(delta)}</span> : "第 2 轮完成后统计"}
          />
          <Stat label="负迁移" value={ntr ? `${ntr.count} / ${ntr.total} 方` : "—"} sub={ntr ? "低于本方第 1 轮" : "第 2 轮完成后统计"} tone={ntr && ntr.count > 0 ? "down" : undefined} />
          <Stat label="产出" value={library ? `${library.insights.length} 条` : "—"} sub={library ? `${output.name} · 第 ${library.builtAfterRound} 轮后` : output.name} />
        </dl>
      </Panel>

      <Panel title={latest > 1 ? `各参与方：第 1 轮 → 第 ${latest} 轮` : "各参与方：第 1 轮"} id="accuracy">
        <DumbbellChart task={task} latest={latest} />
      </Panel>

      <Panel title="明细" id="comparison" flush>
        <ComparisonTable task={task} />
      </Panel>
    </div>
  );
}

/** 哑铃图：每个参与方一行，灰点是第 1 轮（本地），彩点是最新一轮，按变化从大到小排。 */
function DumbbellChart({ task, latest }: { task: Task; latest: number }) {
  const rows = useMemo(() => task.members
    .filter((member) => member.answered > 0)
    .map((member) => {
      const first = accuracy(task, member, 1);
      const last = accuracy(task, member, latest);
      return {
        name: member.participant,
        first: first === null ? null : Number((first * 100).toFixed(1)),
        last: last === null ? null : Number((last * 100).toFixed(1)),
      };
    })
    .filter((row): row is { name: string; first: number; last: number } => row.first !== null && row.last !== null)
    .sort((a, b) => (b.last - b.first) - (a.last - a.first)), [task, latest]);

  const option = useMemo<ChartOption>(() => {
    const values = rows.flatMap((row) => [row.first, row.last]);
    const min = Math.max(0, Math.floor((Math.min(...values) - 5) / 10) * 10);
    const max = Math.min(100, Math.ceil((Math.max(...values) + 5) / 10) * 10);
    const tone = (row: { first: number; last: number }) => (row.last > row.first ? "up" : row.last < row.first ? "down" : "flat");
    const compare = latest > 1;
    return {
      textStyle: { fontFamily: FONT },
      grid: { left: 8, right: 24, top: compare ? 40 : 8, bottom: 24, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(24,24,27,0.04)" } },
        formatter: (params: unknown) => {
          const list = params as { dataIndex: number }[];
          const row = rows[list[0]?.dataIndex ?? 0];
          if (!row) return "";
          const change = row.last - row.first;
          return compare
            ? `${row.name}<br/>第 1 轮 ${row.first}% → 第 ${latest} 轮 ${row.last}%（${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(1)}）`
            : `${row.name}<br/>第 1 轮 ${row.first}%`;
        },
      },
      legend: compare ? {
        top: 0,
        left: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: "#52525b", fontSize: 12 },
        data: ["第 1 轮（本地）", `第 ${latest} 轮（联邦）`],
      } : undefined,
      xAxis: {
        type: "value",
        min,
        max,
        axisLabel: { formatter: "{value}%", color: "#71717a", fontSize: 12 },
        splitLine: { lineStyle: { color: "#f0f0f2" } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: rows.map((row) => row.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: "#18181b", fontSize: 12 },
      },
      series: compare ? [
        { type: "bar", stack: "range", silent: true, barWidth: 3, itemStyle: { color: "transparent" }, data: rows.map((row) => Math.min(row.first, row.last)) },
        {
          type: "bar",
          stack: "range",
          silent: true,
          barWidth: 3,
          data: rows.map((row) => ({ value: Math.abs(row.last - row.first), itemStyle: { color: tone(row) === "down" ? COLORS.downLine : COLORS.upLine } })),
        },
        { name: "第 1 轮（本地）", type: "scatter", symbolSize: 9, color: COLORS.base, data: rows.map((row) => [row.first, row.name]), z: 3 },
        {
          name: `第 ${latest} 轮（联邦）`,
          type: "scatter",
          symbolSize: 11,
          color: COLORS.latest,
          data: rows.map((row) => [row.last, row.name]),
          z: 4,
        },
      ] : [
        { name: "第 1 轮（本地）", type: "scatter", symbolSize: 10, color: COLORS.flat, data: rows.map((row) => [row.first, row.name]) },
      ],
    };
  }, [rows, latest]);

  const height = rows.length * 34 + (latest > 1 ? 64 : 40);
  return (
    <Suspense fallback={<div className="chart chart--loading" style={{ height }}>正在加载图表…</div>}>
      <EChart option={option} height={height} label={latest > 1 ? `各参与方第 1 轮与第 ${latest} 轮的准确率对比` : "各参与方第 1 轮的准确率"} />
    </Suspense>
  );
}

/** 和哑铃图同一个顺序：变化从大到小，没有答案的参与方放最后。 */
function byChange(task: Task) {
  return [...task.members].sort((a, b) => (changeOf(task, b) ?? -Infinity) - (changeOf(task, a) ?? -Infinity));
}

function ComparisonTable({ task }: { task: Task }) {
  const rounds = Array.from({ length: task.config.rounds }, (_, index) => index + 1);
  // 窄屏只保留第 1 轮、最后一轮和变化，中间轮次收起。
  const middle = (round: number) => round !== 1 && round !== rounds.length;
  const first = averageAccuracy(task, 1);
  const latest = latestScoredRound(task);
  const latestAverage = latest ? averageAccuracy(task, latest) : null;
  const averageDelta = latest && latest > 1 && first !== null && latestAverage !== null ? latestAverage - first : null;

  return (
    <div className="table-shell">
      <table className="table table--numbers">
        <thead>
          <tr>
            <th scope="col">参与方</th>
            <th scope="col" className="numeric col-optional">样本</th>
            {rounds.map((round) => {
              const header = roundHeader(round, round === rounds.length);
              return (
                <th key={round} scope="col" className={`numeric${middle(round) ? " col-optional" : ""}`}>
                  {header.main}{header.note ? <span className="wide-only">{header.note}</span> : null}
                </th>
              );
            })}
            <th scope="col" className="numeric">变化<span className="wide-only">（百分点）</span></th>
          </tr>
        </thead>
        <tbody>
          {byChange(task).map((member) => {
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
                      {member.answered === 0 ? <span className="muted">无标注</span> : formatPercent(value)}
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
            <td className="numeric col-optional" />
            {rounds.map((round) => <td key={round} className={`numeric${middle(round) ? " col-optional" : ""}`}>{formatPercent(averageAccuracy(task, round))}</td>)}
            <td className={`numeric ${deltaClass(averageDelta)}`}>{formatDelta(averageDelta, { compact: true })}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
