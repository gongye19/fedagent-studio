import { FOT_STAGES, type Stage } from "../../domain/catalog";
import { averageAccuracy, roundOf, stageSeconds, stepState, type RoundRecord, type StepState, type Task } from "../../domain/task";
import { ProgressBar, SampleNote, StatusPill, type Tone } from "../common";
import { formatDuration, formatNumber, formatPercent, formatTokens } from "../format";
import { Icon } from "../icons";

function sum(values: Record<string, number> | undefined): number {
  return Object.values(values ?? {}).reduce((total, value) => total + value, 0);
}

function doneNote(task: Task, record: RoundRecord | undefined, stage: Stage): string {
  switch (stage.id) {
    case "solve":
      return record ? `平均准确率 ${formatPercent(averageAccuracy(task, record.round))}` : "完成";
    case "extract":
      return `上传 ${formatNumber(sum(record?.traces))} 条 trace`;
    case "collect":
      return `收到 ${formatNumber(sum(record?.traces))} 条`;
    case "profile":
      return record?.library ? `${record.library.clusters.length} 类 · ${formatNumber(record.library.relationships)} 条关系` : "完成";
    case "library":
      return record?.library ? `${record.library.insights.length} 条洞见` : "完成";
    default:
      return "完成";
  }
}

function roundStatus(task: Task, states: StepState[]): { label: string; tone: Tone } {
  if (states.every((state) => state === "done")) return { label: "已完成", tone: "success" };
  if (states.every((state) => state === "pending")) return { label: "未开始", tone: "neutral" };
  if (task.status === "paused") return { label: "已暂停", tone: "warning" };
  if (task.status === "canceled") return { label: "已取消", tone: "neutral" };
  return { label: "进行中", tone: "info" };
}

export function ProgressTab({ task }: { task: Task }) {
  const rounds = Array.from({ length: task.config.rounds }, (_, index) => index + 1);
  return (
    <div className="stack">
      <SampleNote>模拟运行已加速，几十秒就能跑完；真实耗时见每一步的预估。</SampleNote>
      {rounds.map((round) => <RoundBlock key={round} task={task} round={round} />)}
    </div>
  );
}

function RoundBlock({ task, round }: { task: Task; round: number }) {
  const record = roundOf(task, round);
  const states = FOT_STAGES.map((stage) => stepState(task, round, stage.id));
  const status = roundStatus(task, states);
  const current = task.cursor && task.cursor.round === round ? task.cursor : null;
  const showMembers = current && FOT_STAGES.find((stage) => stage.id === current.stage)?.side === "participant";

  return (
    <section className="round-block" aria-labelledby={`round-${round}`}>
      <header className="round-head">
        <h3 id={`round-${round}`}>第 {round} 轮</h3>
        <StatusPill tone={status.tone} live={status.label === "进行中"}>{status.label}</StatusPill>
        <small>{round === 1 ? "没有洞见库，各方单独作答（本地基线）" : `使用第 ${round - 1} 轮后生成的洞见库`}</small>
        {record?.tokens ? <small className="round-tokens">{formatTokens(record.tokens)} token</small> : null}
      </header>
      <ol className="stage-track">
        {FOT_STAGES.map((stage, index) => {
          const state = states[index];
          const paused = state === "current" && task.status !== "running";
          let note = `预计${formatDuration(stageSeconds(task, stage.id))}`;
          if (state === "done") note = doneNote(task, record, stage);
          else if (state === "current" && current) {
            note = stage.side === "participant"
              ? `${formatNumber(sum(current.done))} / ${formatNumber(task.members.reduce((total, member) => total + member.problems, 0))} 题`
              : paused ? "已停止" : "进行中";
          }
          return (
            <li key={stage.id} className={`stage stage--${state}${paused ? " stage--stopped" : ""}${index === 3 ? " stage--server-start" : ""}`}>
              <span className="stage-mark" aria-hidden="true">{state === "done" ? <Icon name="check" /> : index + 1}</span>
              <div>
                <strong>{stage.label}</strong>
                <small>{note}</small>
              </div>
              <span className="visually-hidden">{state === "done" ? "已完成" : state === "current" ? "当前步骤" : "未开始"}，{stage.side === "participant" ? "参与方" : "服务端"}</span>
            </li>
          );
        })}
      </ol>
      <div className="stage-sides" aria-hidden="true">
        <span>参与方各自运行</span>
        <span>服务端</span>
      </div>
      {showMembers && current ? (
        <ul className="member-progress">
          {task.members.map((member) => {
            const done = current.done[member.datasetId] ?? 0;
            return (
              <li key={member.datasetId}>
                <span>{member.participant}</span>
                <ProgressBar value={done / member.problems} label={`${member.participant} 的进度`} tone={task.status === "running" ? "info" : "neutral"} />
                <small>{done} / {member.problems}</small>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
