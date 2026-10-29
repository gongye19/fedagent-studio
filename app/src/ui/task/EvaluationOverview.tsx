import { accuracy, averageAccuracy, evaluationLabel, roundOf, scoreDifference, type Task } from "../../domain/task";
import { Panel } from "../console";
import { Stat } from "../common";
import { InfoTip } from "../InfoTip";
import { formatDelta, formatPercent } from "../format";
import { deltaClass, metricOf } from "../labels";
import { MetricComparison } from "./MetricComparison";
import { CaseComparisons } from "./CaseComparisons";

/** 固定对照由冻结清单声明；不把病例匹配率解读为临床有效性或因果归因。 */
export function EvaluationOverview({ task }: { task: Task }) {
  const labels = task.evaluationLabels ?? [];
  return <div className="panel-stack">
    <Panel title={<>{metricOf(task)}<InfoTip label="对照">三组使用相同独立评测病例和评分规则。第二组相对第一组衡量本地经验增益；第三组相对第二组衡量联邦额外增益。命中经验不代表已经证明它改善了诊断。</InfoTip></>}>
      <dl className="stats stats--comparison">{labels.map((label, i) => {
        const delta = i ? scoreDifference(task, i, i + 1) : null;
        return <Stat key={label} label={label} value={formatPercent(averageAccuracy(task, i + 1))}
          sub={i ? <span className={deltaClass(delta)}>较{labels[i - 1]} {formatDelta(delta)}</span> : "不加载本次任务经验"} />;
      })}</dl>
    </Panel>
    <Panel title="评测对照"><MetricComparison key={task.id} task={task} /></Panel>
    <CaseComparisons key={task.id} task={task} />
    <Panel title="各方明细" flush>
      <div className="table-shell" tabIndex={0} role="region" aria-label="三组评测明细，可横向滚动">
        <table className="table table--numbers">
          <thead><tr><th scope="col">参与方</th><th scope="col" className="numeric">计分病例</th>
            {labels.map((label) => <th key={label} scope="col" className="numeric">{label}</th>)}
            <th scope="col" className="numeric">本地增益</th><th scope="col" className="numeric">联邦额外增益</th>
          </tr></thead>
          <tbody>{task.members.map((member) => <tr key={member.participantId}>
            <th scope="row">{member.agentName ?? member.participant}<small>{Object.entries(member.sampleCounts ?? {}).map(([purpose, n]) => `${purpose} ${n} 条`).join(" · ") || member.dataset}</small></th>
            <td className="numeric">{member.answered}</td>
            {labels.map((_, i) => {
              const correct = roundOf(task, i + 1)?.correct?.[member.participantId];
              return <td key={i} className="numeric">{formatPercent(accuracy(task, member, i + 1))}{correct !== undefined ? <small>匹配 {correct} / {member.answered}</small> : null}</td>;
            })}
            {[1, 2].map((from) => <td key={from} className={`numeric ${deltaClass(scoreDifference(task, from, from + 1, member))}`}>{formatDelta(scoreDifference(task, from, from + 1, member), { compact: true })}</td>)}
          </tr>)}</tbody>
          <tfoot><tr><th scope="row">各方平均</th><td />
            {labels.map((_, i) => <td key={i} className="numeric">{formatPercent(averageAccuracy(task, i + 1))}</td>)}
            {[1, 2].map((from) => <td key={from} className={`numeric ${deltaClass(scoreDifference(task, from, from + 1))}`}>{formatDelta(scoreDifference(task, from, from + 1), { compact: true })}</td>)}
          </tr></tfoot>
        </table>
      </div>
      <p className="comparison-note">变化单位：百分点。{evaluationLabel(task, 3)} − {evaluationLabel(task, 2)} 为联邦额外增益。</p>
    </Panel>
  </div>;
}
