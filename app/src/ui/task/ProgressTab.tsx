import { evaluationLabel, stagesOf, stepState, type StepState, type Task } from "../../domain/task";
import type { Stage } from "../../domain/catalog";
import { CheckStatus } from "../CheckStatus";
import { Panel } from "../console";
import { Icon } from "../icons";

/** 阶段有先后顺序，但耗时不等；只展示真实状态，不将工作单元数换算成百分比。 */
export function ProgressTab({ task }: { task: Task }) {
  return <Panel title="运行过程">
    <ol className="execution-rounds" aria-label="各轮执行过程">
      {Array.from({ length: task.config.rounds }, (_, i) => i + 1).map((round) => <li key={round}>
        <h3>{evaluationLabel(task, round)}</h3>
        <ol className="execution-timeline" aria-label={`${evaluationLabel(task, round)}步骤`}>
          {stagesOf(task, round).map((stage) => <StageItem key={stage.id} task={task} stage={stage} round={round} />)}
        </ol>
      </li>)}
    </ol>
  </Panel>;
}

function StageItem({ task, stage, round }: { task: Task; stage: Stage; round: number }) {
  const state = stepState(task, round, stage.id);
  const current = state === "current";
  const label = state === "done" ? "已完成" : !current ? "未开始" : task.status === "running" ? "进行中" : task.status === "paused" ? "已暂停" : task.status === "canceled" ? "已取消" : "待执行";
  return <li className="execution-step" data-state={state} aria-current={current ? "step" : undefined}>
    <div className="execution-step-head">
      <StageMark task={task} state={state} label={label} />
      <strong>{stage.label}</strong><span className="execution-step-status">{label}</span>
    </div>
    {current && stage.side === "participant" ? <ul className="execution-members" aria-label={`${stage.label}各方状态`}>
      {task.members.map((member) => {
        const total = stage.per === "site" ? 1 : member.problems;
        const done = total > 0 && (task.cursor?.done[member.participantId] ?? 0) >= total;
        // done 仅说明该方整个步骤已经提交；其余状态不猜测排队、内部动作或样本完成率。
        return <li key={member.participantId}>
          <CheckStatus status={done ? "passed" : "pending"} label={done ? "已完成" : "未完成"} />
          <span>{member.agentName ?? member.participant}</span>
          <small>{done ? "已完成" : "未完成"}</small>
        </li>;
      })}
    </ul> : null}
  </li>;
}

function StageMark({ task, state, label }: { task: Task; state: StepState; label: string }) {
  if (state === "current" && (task.status === "paused" || task.status === "canceled"))
    return <span className="execution-stopped" role="img" aria-label={label}><Icon name={task.status === "paused" ? "pause" : "x"} /></span>;
  return <CheckStatus label={label} status={state === "done" ? "passed" : state === "current" && task.status === "running" ? "running" : "pending"} />;
}
