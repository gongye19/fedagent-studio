import {
  accuracy,
  averageAccuracy,
  changeOf,
  latestScoredRound,
  negativeTransfer,
  outputs,
  roundOf,
  scoredRounds,
  type Task,
} from "../../domain/task";
import { hrefOf } from "../../state/route";
import { publishedOf, type State } from "../../state/store";
import { GRADERS, TASK_TYPES } from "../../domain/catalog";
import { InfoTip } from "../InfoTip";
import { CaseResults } from "./CaseResults";
import { EvaluationOverview } from "./EvaluationOverview";
import { MetricComparison } from "./MetricComparison";
import { EmptyState, Stat, Tag } from "../common";
import { Panel } from "../console";
import { formatDelta, formatPercent } from "../format";
import { algorithmOfTask, deltaClass, metricOf, roundHeader } from "../labels";

export function OverviewTab({ task, state }: { task: Task; state: State }) {
  if (TASK_TYPES[task.config.taskType]?.recordBased) {
    const output=outputs(task).at(-1);
    return <Panel title="经验生成"><dl className="stats">
      <Stat label="数据来源" value={String(task.members.length)} />
      <Stat label="过程记录" value={String(task.members.reduce((n,m)=>n+m.problems,0))} />
      <Stat label="经验条目" value={output ? String(output.items.length) : "—"}
        href={output ? hrefOf({page:"task",id:task.id,tab:"output"}) : undefined} />
    </dl><p>过程记录用于生成经验。请在应用中使用未参与学习的新输入检验效果。</p></Panel>;
  }
  if (task.evaluationLabels?.length) return <EvaluationOverview task={task} />;
  return <IterativeOverview task={task} state={state} />;
}

function IterativeOverview({ task, state }: { task: Task; state: State }) {
  const rounds = scoredRounds(task);
  const metric = metricOf(task);
  const product = algorithmOfTask(task).output;
  const historicalGrader = Boolean(task.config.grader && task.config.grader !== TASK_TYPES[task.config.taskType].grader);
  if (!rounds.length) {
    return (
      <div className="panel-stack"><EmptyState title="还没有结果" action={<a className="button button--secondary" href={hrefOf({ page: "task", id: task.id, tab: "progress" })}>查看进度</a>}>
        <p>第 1 轮完成后，这里显示各参与方的{metric}。</p>
      </EmptyState>{task.status === "paused" || task.status === "canceled" ? <CaseResults key={task.id} task={task} /> : null}</div>
    );
  }
  const latest = rounds[rounds.length - 1];
  const first = averageAccuracy(task, 1);
  const last = averageAccuracy(task, latest);
  const delta = latest > 1 && first !== null && last !== null ? last - first : null;
  const ntr = negativeTransfer(task);
  const output = outputs(task).at(-1);
  const published = output ? publishedOf(state, task.id, output.builtAfterRound) : undefined;

  return (
    <div className="panel-stack">
      <Panel extra={historicalGrader ? <Tag>历史判分</Tag> : undefined} title={<>{metric}<InfoTip label="评分规则">{historicalGrader ? "本任务保留创建时的判分规则。" : ""}{GRADERS[task.config.grader || TASK_TYPES[task.config.taskType].grader]?.detail ?? "按任务所选判分规则统计匹配数。"}百分比表示评测结果，不是运行进度。</InfoTip></>}>
        <dl className="stats">
          <Stat label="联邦前（第 1 轮）" value={formatPercent(first)} sub="各方单独作答" />
          <Stat
            label={latest > 1 ? `联邦后（第 ${latest} 轮）` : "联邦"}
            value={latest > 1 ? formatPercent(last) : "—"}
            sub={latest > 1 ? <span className={deltaClass(delta)}>{formatDelta(delta)}</span> : "第 2 轮完成后统计"}
          />
          <Stat label="效果下降" value={ntr ? `${ntr.count} / ${ntr.total} 方` : "—"} sub={ntr ? "低于本方联邦前结果" : "第 2 轮完成后统计"} tone={ntr && ntr.count > 0 ? "down" : undefined} />
          <Stat
            label="产出"
            value={output ? `${output.items.length} 条` : "—"}
            href={output ? hrefOf({ page: "task", id: task.id, tab: "output" }) : undefined}
            sub={output ? `${product.name} · 第 ${output.builtAfterRound} 轮后${published ? " · 已发布" : ""}` : product.name}
          />
        </dl>
      </Panel>

      <Panel title="逐轮效果" id="accuracy">
        <MetricComparison task={task} latest={latest} />
      </Panel>

      <CaseResults key={task.id} task={task} />

      <Panel title="明细" id="comparison" flush>
        <ComparisonTable task={task} />
      </Panel>
    </div>
  );
}

/** 各方按相对基线的变化排序；没有结果的放最后。 */
function byChange(task: Task) {
  return [...task.members].sort((a, b) => (changeOf(task, b) ?? -Infinity) - (changeOf(task, a) ?? -Infinity));
}

function ComparisonTable({ task }: { task: Task }) {
  const rounds = Array.from({ length: task.config.rounds }, (_, index) => index + 1);
  const first = averageAccuracy(task, 1);
  const latest = latestScoredRound(task);
  const latestAverage = latest ? averageAccuracy(task, latest) : null;
  const averageDelta = latest && latest > 1 && first !== null && latestAverage !== null ? latestAverage - first : null;

  return (
    <div className="table-shell" tabIndex={0} role="region" aria-label="逐轮评测明细，可横向滚动">
      <table className="table table--numbers">
        <thead>
          <tr>
            <th scope="col">参与方</th>
            <th scope="col" className="numeric col-optional">评测样本</th>
            {rounds.map((round) => {
              const header = roundHeader(round, round === rounds.length);
              return (
                <th key={round} scope="col" className="numeric">
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
              <tr key={member.participantId}>
                <th scope="row">
                  {member.participant}
                  <small>{member.dataset}</small>
                </th>
                <td className="numeric col-optional">{member.answered}<small>选用 {member.problems} 条</small></td>
                {rounds.map((round) => {
                  const value = accuracy(task, member, round);
                  const correct = roundOf(task, round)?.correct?.[member.participantId];
                  return (
                    <td key={round} className="numeric">
                      {member.answered === 0 ? <span className="muted">无标注</span> : formatPercent(value)}
                      {correct !== undefined ? <small>匹配 {correct} / {member.answered}</small> : null}
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
            {rounds.map((round) => <td key={round} className="numeric">{formatPercent(averageAccuracy(task, round))}</td>)}
            <td className={`numeric ${deltaClass(averageDelta)}`}>{formatDelta(averageDelta, { compact: true })}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
