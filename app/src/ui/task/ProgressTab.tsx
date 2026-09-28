import { useState } from "react";
import { FOT_STAGES, type Stage } from "../../domain/catalog";
import { sampleTraceTexts } from "../../domain/sample";
import { averageAccuracy, roundOf, stageSeconds, stepState, type RoundRecord, type StepState, type Task } from "../../domain/task";
import { ProgressBar, Section } from "../common";
import { formatDuration, formatNumber, formatPercent, formatTokens } from "../format";
import { Icon } from "../icons";

const SHOWN = 3;

function sum(values: Record<string, number> | undefined): number {
  return Object.values(values ?? {}).reduce((total, value) => total + value, 0);
}

function roundStateOf(task: Task, round: number): "done" | "current" | "pending" {
  const states = FOT_STAGES.map((stage) => stepState(task, round, stage.id));
  if (states.every((state) => state === "done")) return "done";
  if (states.every((state) => state === "pending")) return "pending";
  return "current";
}

/** 一轮完成后的一行摘要。 */
function roundSummary(task: Task, record: RoundRecord | undefined): string {
  if (!record) return "";
  const parts = [`平均准确率 ${formatPercent(averageAccuracy(task, record.round))}`, `上传 ${formatNumber(sum(record.traces))} 条 trace`];
  if (record.library) parts.push(`洞见库 ${record.library.insights.length} 条`);
  if (record.tokens) parts.push(`${formatTokens(record.tokens)} token`);
  return parts.join(" · ");
}

export function ProgressTab({ task }: { task: Task }) {
  const rounds = Array.from({ length: task.config.rounds }, (_, index) => index + 1);
  return (
    <div className="stack stack--loose">
      <Section title="各轮进度" id="rounds">
        <ol className="round-list">
          {rounds.map((round) => <RoundItem key={round} task={task} round={round} />)}
        </ol>
      </Section>
      <Section title="服务端收到的 trace" id="uploads" meta="题目、标准答案和解答全文都留在参与方，服务端只收到这些 trace。">
        <Uploads task={task} />
      </Section>
    </div>
  );
}

function RoundItem({ task, round }: { task: Task; round: number }) {
  const record = roundOf(task, round);
  const state = roundStateOf(task, round);
  const base = round === 1 ? "没有洞见库" : `用第 ${round - 1} 轮后的洞见库`;

  if (state === "done") {
    return (
      <li className="round round--done">
        <details>
          <summary>
            <span className="round-mark" aria-hidden="true"><Icon name="check" /></span>
            <h3>第 {round} 轮</h3>
            <span className="round-summary">{roundSummary(task, record)}</span>
          </summary>
          <StepLine task={task} round={round} record={record} />
        </details>
      </li>
    );
  }

  if (state === "pending") {
    const seconds = FOT_STAGES.reduce((total, stage) => total + stageSeconds(task, stage.id), 0);
    return (
      <li className="round round--pending">
        <div className="round-head">
          <span className="round-mark" aria-hidden="true">{round}</span>
          <h3>第 {round} 轮</h3>
          <span className="round-summary">未开始 · {base} · 预计{formatDuration(seconds)}</span>
        </div>
      </li>
    );
  }

  const cursor = task.cursor;
  const stopped = task.status === "paused" ? "已暂停" : task.status === "canceled" ? "已取消" : "进行中";
  const participantStage = cursor && FOT_STAGES.find((stage) => stage.id === cursor.stage)?.side === "participant";
  return (
    <li className="round round--current">
      <div className="round-head">
        <span className="round-mark" aria-hidden="true">{round}</span>
        <h3>第 {round} 轮</h3>
        <span className="round-summary">{stopped} · {base}</span>
      </div>
      <StepLine task={task} round={round} record={record} />
      {participantStage && cursor ? (
        <ul className="member-progress" aria-label="各参与方进度">
          {task.members.map((member) => {
            const done = cursor.done[member.datasetId] ?? 0;
            return (
              <li key={member.datasetId}>
                <span>{member.participant}</span>
                <ProgressBar value={done / member.problems} label={`${member.participant} 的进度`} tone={task.status === "running" ? "info" : "neutral"} />
                <span className="member-count">{done} / {member.problems}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

function stepNote(task: Task, record: RoundRecord | undefined, stage: Stage, state: StepState): string {
  if (state === "pending") return `预计${formatDuration(stageSeconds(task, stage.id))}`;
  if (state === "current") {
    const cursor = task.cursor;
    if (!cursor) return "";
    if (stage.side === "participant") {
      const total = task.members.reduce((count, member) => count + member.problems, 0);
      return `${formatNumber(sum(cursor.done))} / ${formatNumber(total)} 题`;
    }
    return task.status === "running" ? "进行中" : "已停止";
  }
  switch (stage.id) {
    case "solve":
      return record ? `准确率 ${formatPercent(averageAccuracy(task, record.round))}` : "完成";
    case "extract":
      return `${formatNumber(sum(record?.traces))} 条 trace`;
    case "collect":
      return `收到 ${formatNumber(sum(record?.traces))} 条`;
    case "profile":
      return record?.library ? `${record.library.clusters.length} 类` : "完成";
    case "library":
      return record?.library ? `${record.library.insights.length} 条洞见` : "完成";
    default:
      return "完成";
  }
}

/** 一轮的 6 步：参与方 3 步、服务端 3 步分两组。 */
function StepLine({ task, round, record }: { task: Task; round: number; record: RoundRecord | undefined }) {
  const groups = [
    { label: "参与方", stages: FOT_STAGES.filter((stage) => stage.side === "participant") },
    { label: "服务端", stages: FOT_STAGES.filter((stage) => stage.side === "server") },
  ];
  return (
    <div className="step-line">
      {groups.map((group) => (
        <div key={group.label} className="step-group">
          <span className="step-group-label">{group.label}</span>
          <ol>
            {group.stages.map((stage) => {
              const state = stepState(task, round, stage.id);
              const stopped = state === "current" && task.status !== "running";
              const index = FOT_STAGES.indexOf(stage) + 1;
              return (
                <li key={stage.id} className={`step step--${state}${stopped ? " step--stopped" : ""}`}>
                  <span className="step-mark" aria-hidden="true">{state === "done" ? <Icon name="check" /> : index}</span>
                  <span className="step-copy">
                    <strong>{stage.label}</strong>
                    <small>{stepNote(task, record, stage, state)}</small>
                  </span>
                  <span className="visually-hidden">{state === "done" ? "已完成" : state === "current" ? "当前步骤" : "未开始"}</span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

function Uploads({ task }: { task: Task }) {
  const rounds = task.rounds.filter((record) => record.traces).map((record) => record.round);
  const [cell, setCell] = useState<{ datasetId: string; round: number } | null>(null);
  if (!rounds.length) return <p className="section-empty">第 1 轮的“提取 trace”完成后，这里列出每个参与方上传的内容。</p>;

  const active = cell ?? { datasetId: task.members[0].datasetId, round: rounds[rounds.length - 1] };
  const member = task.members.find((item) => item.datasetId === active.datasetId) ?? task.members[0];
  const count = task.rounds.find((record) => record.round === active.round)?.traces?.[member.datasetId] ?? 0;

  return (
    <div className="uploads">
      <div className="table-shell">
        <table className="table table--numbers">
          <caption className="visually-hidden">每个参与方每轮上传的 trace 数，点数字查看内容</caption>
          <thead>
            <tr>
              <th scope="col">参与方</th>
              {rounds.map((round) => <th key={round} scope="col" className="numeric">第 {round} 轮</th>)}
            </tr>
          </thead>
          <tbody>
            {task.members.map((item) => (
              <tr key={item.datasetId}>
                <th scope="row">{item.participant}</th>
                {rounds.map((round) => {
                  const value = task.rounds.find((record) => record.round === round)?.traces?.[item.datasetId] ?? 0;
                  const selected = active.datasetId === item.datasetId && active.round === round;
                  return (
                    <td key={round} className="numeric">
                      <button
                        type="button"
                        className={`cell-button${selected ? " cell-button--active" : ""}`}
                        aria-pressed={selected}
                        aria-label={`${item.participant} 第 ${round} 轮上传 ${value} 条 trace，查看内容`}
                        onClick={() => setCell({ datasetId: item.datasetId, round })}
                      >
                        {formatNumber(value)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="trace-panel" aria-live="polite">
        <h3>{member.participant} · 第 {active.round} 轮</h3>
        <p className="section-meta">共 {formatNumber(count)} 条，展示前 {Math.min(SHOWN, count)} 条</p>
        <ol className="trace-list">
          {sampleTraceTexts(member.datasetId, active.round, Math.min(SHOWN, count)).map((trace) => (
            <li key={trace.key} lang="en">{trace.text}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
