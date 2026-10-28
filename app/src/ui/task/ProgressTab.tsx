import { progressOf, stagesOf, stepState, type Task } from "../../domain/task";
import { CheckStatus } from "../CheckStatus";
import { Panel } from "../console";
import { ProgressBar } from "../common";
import { Icon } from "../icons";

/** 只用已完成步骤和样本计数；动画表示仍在执行，不推算内部百分比。 */
export function ProgressTab({ task }: { task: Task }) {
  const running = task.status === "running";
  const completed = task.status === "completed";
  const currentRound = task.cursor?.round ?? (completed ? task.config.rounds : 1);
  const stages = stagesOf(task, currentRound);
  const stage = stages.find((s) => s.id === task.cursor?.stage);
  const progress = progressOf(task);
  const label = completed ? "运行完成" : task.status === "paused" ? "已暂停" : task.status === "canceled" ? "已取消" : task.status === "queued" ? "排队中" : stage?.label ?? "运行中";
  const tone = task.status === "paused" ? "warning" : task.status === "canceled" ? "neutral" : "info";
  return <Panel title="运行进度">
    <div className={`execution-progress${running ? " execution-progress--active" : ""}`}>
      <div className="execution-heading" role="status">
        {task.status === "paused" ? <Icon name="pause" /> : task.status === "canceled" ? <Icon name="x" /> : <CheckStatus label={label} status={completed ? "passed" : running ? "running" : "pending"} />}
        <strong>{label}</strong><span className="execution-percent">{Math.floor(progress * 100)}%</span>
      </div>
      <ProgressBar value={progress} label="任务完成进度" tone={tone} />
      <div className="execution-rounds" aria-label="轮次进度">
        {Array.from({ length: task.config.rounds }, (_, i) => i + 1).map((round) => <span key={round} className={round === currentRound ? "execution-round--current" : ""}>
          <CheckStatus label={completed || round < currentRound ? "已完成" : round === currentRound && running ? "运行中" : "待运行"} status={completed || round < currentRound ? "passed" : round === currentRound && running ? "running" : "pending"} />第 {round} 轮
        </span>)}
      </div>
      <ol className="execution-stages" aria-label={`第 ${currentRound} 轮步骤`}>
        {stages.map((s) => {
          const state = task.status === "queued" ? "pending" : stepState(task, currentRound, s.id);
          return <li key={s.id} aria-current={state === "current" ? "step" : undefined}>
            <CheckStatus label={state === "done" ? "已完成" : state === "current" && running ? "运行中" : "未完成"} status={state === "done" ? "passed" : state === "current" && running ? "running" : "pending"} /><span>{s.label}</span>
          </li>;
        })}
      </ol>
      {stage?.side === "participant" && task.cursor ? <ul className="execution-members" aria-label="各方当前步骤进度">
        {task.members.map((member) => {
          const total = stage.per === "site" ? 1 : member.problems;
          const done = Math.min(total, task.cursor?.done[member.participantId] ?? 0);
          return <li key={member.participantId}>
            <span title={member.agentName ?? member.participant}>{member.agentName ?? member.participant}</span>
            <ProgressBar value={total ? done / total : 0} label={`${member.participant}当前步骤`} tone={tone} />
            <span>{done} / {total}</span>
          </li>;
        })}
      </ul> : null}
    </div>
  </Panel>;
}
