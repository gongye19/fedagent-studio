import { accuracy, changeOf, roundOf, type Member, type Task } from "../../domain/task";
import { formatDelta, formatPercent } from "../format";
import { deltaClass } from "../labels";
import { InfoTip } from "../InfoTip";

/** 每个结果独占一行；持平和零分也能同时看到两轮，不依赖悬停读取。 */
export function MetricComparison({ task, latest }: { task: Task; latest: number }) {
  const members = [...task.members].sort((a, b) => (changeOf(task, b) ?? -Infinity) - (changeOf(task, a) ?? -Infinity));
  return (
    <ul className="metric-comparison" aria-label="各方联邦前后评测结果">
      {members.map((member) => (
        <li key={member.participantId}>
          <div className="metric-comparison-head">
            <div><strong>{member.participant}</strong><span className="muted">{member.dataset}</span></div>
            {latest > 1 ? <span className={deltaClass(changeOf(task, member))}>{formatDelta(changeOf(task, member))}</span> : null}
          </div>
          <div className="metric-comparison-count">
            选用 {member.problems} 条 · 评测 {member.answered} 条
            <InfoTip label={`${member.participant}评测样本`}>每轮使用同一批有标注的评测样本；用于经验生成或无评测标注的样本不计入分母。样本很少时，单条结果就会显著影响百分比。</InfoTip>
          </div>
          <ScoreBar task={task} member={member} round={1} label="联邦前 · 第 1 轮" />
          {latest > 1 ? <ScoreBar task={task} member={member} round={latest} label={`联邦后 · 第 ${latest} 轮`} federated /> : null}
        </li>
      ))}
    </ul>
  );
}

function ScoreBar({ task, member, round, label, federated = false }: {
  task: Task; member: Member; round: number; label: string; federated?: boolean;
}) {
  const value = accuracy(task, member, round);
  const correct = roundOf(task, round)?.correct?.[member.participantId];
  return (
    <div className={`metric-score${federated ? " metric-score--federated" : ""}`}>
      <span className="metric-score-label">{label}</span>
      <span className="metric-score-track" aria-hidden="true"><span style={{ width: `${(value ?? 0) * 100}%` }} /></span>
      <span className="metric-score-value">{formatPercent(value)}</span>
      <span className="metric-score-count">{value !== null && correct !== undefined ? `匹配 ${correct}/${member.answered}` : member.answered ? "待评测" : "无评测标注"}</span>
    </div>
  );
}
