import { useState } from "react";
import type { Stage } from "../../domain/catalog";
import { averageAccuracy, roundOf, stageSeconds, stagesOf, stepState, type RoundRecord, type StepState, type Task } from "../../domain/task";
import { ProgressBar } from "../common";
import { Panel } from "../console";
import { formatDuration, formatNumber, formatPercent } from "../format";
import { ProcessPanel } from "./ProcessPanel";
import { CommunicationPanel } from "./CommunicationPanel";
import { Icon } from "../icons";
import { algorithmOfTask, metricOf } from "../labels";


function sum(values: Record<string, number> | null | undefined): number {
  return Object.values(values ?? {}).reduce((total, value) => total + value, 0);
}

function roundStateOf(task: Task, round: number): "done" | "current" | "pending" {
  const states = stagesOf(task, round).map((stage) => stepState(task, round, stage.id));
  if (states.every((state) => state === "done")) return "done";
  if (states.every((state) => state === "pending")) return "pending";
  return "current";
}

/** 停下来的任务：暂停用黄色，取消用灰色，和任务状态标签一致。 */
function stopTone(task: Task): "" | "paused" | "canceled" {
  return task.status === "paused" ? "paused" : task.status === "canceled" ? "canceled" : "";
}

/** 一轮完成后的一行摘要：指标、上传量、产出。 */
function roundSummary(task: Task, record: RoundRecord | undefined): string {
  if (!record) return "";
  const output = algorithmOfTask(task).output;
  const parts = [`${metricOf(task)} ${formatPercent(averageAccuracy(task, record.round))}`];
  if (record.uploads) parts.push(`上传 ${formatNumber(sum(record.uploads))} 条`);
  if (record.output) parts.push(`${output.name} ${record.output.items.length} 条`);
  return parts.join(" · ");
}

export function ProgressTab({ task }: { task: Task }) {
  const rounds = Array.from({ length: task.config.rounds }, (_, index) => index + 1);
  return (
    <div className="panel-stack">
      <Panel title="各轮进度" id="rounds">
        <ol className="round-list">
          {rounds.map((round) => <RoundItem key={round} task={task} round={round} />)}
        </ol>
      </Panel>
      <ProcessPanel task={task} />
      <CommunicationPanel task={task} />
    </div>
  );
}

function RoundItem({ task, round }: { task: Task; round: number }) {
  const record = roundOf(task, round);
  const state = roundStateOf(task, round);
  const output = algorithmOfTask(task).output.name;
  const base = round === 1 ? `还没有${output}（本地基线）` : `用第 ${round - 1} 轮的${output}`;
  // 首次展开才生成步骤；收起后保留，供原生 details 平滑关闭。
  const [open, setOpen] = useState(task.status === "completed" && round === task.config.rounds);
  const [visited, setVisited] = useState(open);

  if (state === "done") {
    return (
      <li className="round round--done">
        <details open={open} onToggle={(event) => {
          const next = event.currentTarget.open;
          setOpen(next);
          if (next) setVisited(true);
        }}>
          <summary className="round-head">
            <Icon name="chevron" />
            <span className="round-mark" aria-hidden="true"><Icon name="check" /></span>
            <span className="round-title">
              <h3>第 {round} 轮</h3>
              <span className="round-summary">{roundSummary(task, record)}</span>
            </span>
          </summary>
          {visited ? <StepLine task={task} round={round} record={record} /> : null}
        </details>
      </li>
    );
  }

  if (state === "pending") {
    const seconds = stagesOf(task, round).reduce((total, stage) => total + stageSeconds(task, stage.id), 0);
    return (
      <li className="round round--pending">
        <div className="round-head">
          <span className="round-spacer" aria-hidden="true" />
          <span className="round-mark" aria-hidden="true">{round}</span>
          <span className="round-title">
            <h3>第 {round} 轮</h3>
            <span className="round-summary">未开始 · {base}{task.config.execution === "agent" ? "" : ` · 预计 ${formatDuration(seconds)}`}</span>
          </span>
        </div>
      </li>
    );
  }

  const tone = stopTone(task);
  return (
    <li className={`round round--current${tone ? ` round--${tone}` : ""}`}>
      <div className="round-head">
        <span className="round-spacer" aria-hidden="true" />
        <span className="round-mark" aria-hidden="true">{round}</span>
        <span className="round-title">
          <h3>第 {round} 轮</h3>
          <span className="round-summary">{stoppedText(task)} · {base}</span>
        </span>
      </div>
      <StepLine task={task} round={round} record={record} />
    </li>
  );
}

/** 停下来的步骤写明是暂停还是取消，和任务状态用同一个词。 */
function stoppedText(task: Task): string {
  return task.status === "paused" ? "已暂停" : task.status === "canceled" ? "已取消" : "进行中";
}

/** 每一步下面的一行结果。写什么由算法在注册表里声明（stage.result），这里不认具体的算法。 */
function stepNote(task: Task, record: RoundRecord | undefined, stage: Stage, state: StepState): string {
  if (state === "pending") return stage.side === "participant" && task.config.execution === "agent" ? "等待执行" : `预计 ${formatDuration(stageSeconds(task, stage.id))}`;
  if (state === "current") {
    const cursor = task.cursor;
    if (!cursor) return "";
    if (stage.side === "participant") {
      const total = stage.per === "site" ? task.members.length : task.members.reduce((count, member) => count + member.problems, 0);
      const done = `${formatNumber(sum(cursor.done))} / ${formatNumber(total)} 条`;
      return task.status === "running" ? done : `${stoppedText(task)} · ${done}`;
    }
    return stoppedText(task);
  }
  const output = algorithmOfTask(task).output;
  switch (stage.result) {
    case "metric":
      return record ? `${metricOf(task)} ${formatPercent(averageAccuracy(task, record.round))}` : "完成";
    case "uploads":
      return `上传 ${formatNumber(sum(record?.uploads))} 条`;
    case "received":
      return `收到 ${formatNumber(sum(record?.uploads))} 条`;
    case "groups":
      return record?.groups ? `${record.groups.length} 类` : "完成";
    case "output":
      return record?.output ? `${record.output.items.length} ${output.unit}` : "完成";
    default:
      return "完成";
  }
}

/** 一轮的步骤：参与方、服务端分两组；参与方正在执行时，各方进度放在参与方这一组里。 */
function StepLine({ task, round, record }: { task: Task; round: number; record: RoundRecord | undefined }) {
  const cursor = task.cursor;
  const stages = stagesOf(task, round);
  const showMembers = cursor?.round === round && stages.find((stage) => stage.id === cursor.stage)?.side === "participant";
  const tone = stopTone(task);
  const groups = [
    { label: "参与方", side: "participant", stages: stages.filter((stage) => stage.side === "participant") },
    { label: "服务端", side: "server", stages: stages.filter((stage) => stage.side === "server") },
  ].filter((group) => group.stages.length > 0);
  return (
    <div className={`step-line${groups.length === 1 ? " step-line--single" : ""}`}>
      {groups.map((group) => (
        <div key={group.label} className="step-group">
          <span className="step-group-label">{group.label}</span>
          <ol>
            {group.stages.map((stage) => {
              const state = stepState(task, round, stage.id);
              const stopped = state === "current" && tone ? ` step--${tone}` : "";
              const index = stages.indexOf(stage) + 1;
              return (
                <li key={stage.id} className={`step step--${state}${stopped}`}>
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
          {group.side === "participant" && showMembers && cursor ? (
            <ul className="member-progress" aria-label="各参与方进度">
              {task.members.map((member) => {
                const done = cursor.done[member.participantId] ?? 0;
                const total = stages.find((s) => s.id === cursor.stage)?.per === "site" ? 1 : member.problems;
                return (
                  <li key={member.participantId}>
                    <span>{member.participant}</span>
                    <ProgressBar value={done / total} label={`${member.participant} 的进度`} tone={tone === "paused" ? "warning" : tone === "canceled" ? "neutral" : "info"} />
                    <span className="member-count">{done} / {total}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}
