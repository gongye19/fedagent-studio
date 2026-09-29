import { useRef, useState, type KeyboardEvent } from "react";
import type { Stage } from "../../domain/catalog";
import { sampleTraceTexts } from "../../domain/sample";
import { averageAccuracy, roundOf, stageSeconds, stepState, type RoundRecord, type StepState, type Task } from "../../domain/task";
import { ProgressBar } from "../common";
import { Panel } from "../console";
import { formatDuration, formatNumber, formatPercent } from "../format";
import { Icon } from "../icons";
import { algorithmOfTask, metricOf } from "../labels";

const SHOWN = 3;

function sum(values: Record<string, number> | undefined): number {
  return Object.values(values ?? {}).reduce((total, value) => total + value, 0);
}

function roundStateOf(task: Task, round: number): "done" | "current" | "pending" {
  const states = algorithmOfTask(task).stages.map((stage) => stepState(task, round, stage.id));
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
  const parts = [`${metricOf(task)} ${formatPercent(averageAccuracy(task, record.round))}`, `上传 ${formatNumber(sum(record.traces))} 条`];
  if (record.library) parts.push(`${output.name} ${record.library.insights.length} 条`);
  return parts.join(" · ");
}

export function ProgressTab({ task }: { task: Task }) {
  const rounds = Array.from({ length: task.config.rounds }, (_, index) => index + 1);
  const algorithm = algorithmOfTask(task);
  return (
    <div className="panel-stack">
      <Panel title="各轮进度" id="rounds">
        <ol className="round-list">
          {rounds.map((round) => <RoundItem key={round} task={task} round={round} />)}
        </ol>
      </Panel>
      <Panel title="通信记录" id="uploads" extra={`上传内容：${algorithm.exchange}`}>
        <Uploads task={task} />
      </Panel>
    </div>
  );
}

function RoundItem({ task, round }: { task: Task; round: number }) {
  const record = roundOf(task, round);
  const state = roundStateOf(task, round);
  const output = algorithmOfTask(task).output.name;
  const base = round === 1 ? `还没有${output}（本地基线）` : `用第 ${round - 1} 轮的${output}`;
  // 收起的轮次不渲染步骤，展开时才生成。
  const [open, setOpen] = useState(false);

  if (state === "done") {
    return (
      <li className="round round--done">
        <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
          <summary className="round-head">
            <Icon name="chevron" />
            <span className="round-mark" aria-hidden="true"><Icon name="check" /></span>
            <span className="round-title">
              <h3>第 {round} 轮</h3>
              <span className="round-summary">{roundSummary(task, record)}</span>
            </span>
          </summary>
          {open ? <StepLine task={task} round={round} record={record} /> : null}
        </details>
      </li>
    );
  }

  if (state === "pending") {
    const seconds = algorithmOfTask(task).stages.reduce((total, stage) => total + stageSeconds(task, stage.id), 0);
    return (
      <li className="round round--pending">
        <div className="round-head">
          <span className="round-spacer" aria-hidden="true" />
          <span className="round-mark" aria-hidden="true">{round}</span>
          <span className="round-title">
            <h3>第 {round} 轮</h3>
            <span className="round-summary">未开始 · {base} · {formatDuration(seconds)}</span>
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
  if (state === "pending") return formatDuration(stageSeconds(task, stage.id));
  if (state === "current") {
    const cursor = task.cursor;
    if (!cursor) return "";
    if (stage.side === "participant") {
      const total = task.members.reduce((count, member) => count + member.problems, 0);
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
      return `上传 ${formatNumber(sum(record?.traces))} 条`;
    case "received":
      return `收到 ${formatNumber(sum(record?.traces))} 条`;
    case "groups":
      return record?.library ? `${record.library.clusters.length} 类` : "完成";
    case "output":
      return record?.library ? `${record.library.insights.length} ${output.unit}` : "完成";
    default:
      return "完成";
  }
}

/** 一轮的步骤：参与方、服务端分两组；参与方正在执行时，各方进度放在参与方这一组里。 */
function StepLine({ task, round, record }: { task: Task; round: number; record: RoundRecord | undefined }) {
  const cursor = task.cursor;
  const stages = algorithmOfTask(task).stages;
  const showMembers = cursor?.round === round && stages.find((stage) => stage.id === cursor.stage)?.side === "participant";
  const tone = stopTone(task);
  const groups = [
    { label: "参与方", side: "participant", stages: stages.filter((stage) => stage.side === "participant") },
    { label: "服务端", side: "server", stages: stages.filter((stage) => stage.side === "server") },
  ];
  return (
    <div className="step-line">
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
                const done = cursor.done[member.datasetId] ?? 0;
                return (
                  <li key={member.datasetId}>
                    <span>{member.participant}</span>
                    <ProgressBar value={done / member.problems} label={`${member.participant} 的进度`} tone={tone === "paused" ? "warning" : tone === "canceled" ? "neutral" : "info"} />
                    <span className="member-count">{done} / {member.problems}</span>
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

/**
 * 通信记录：每个参与方每轮上传的条数，点数字在右边看内容。
 * 整张表只占一个 Tab 停靠点，用方向键在格子之间移动（和表格网格的键盘习惯一致）。
 */
function Uploads({ task }: { task: Task }) {
  const rounds = task.rounds.filter((record) => record.traces).map((record) => record.round);
  const [cell, setCell] = useState<{ datasetId: string; round: number } | null>(null);
  const grid = useRef<HTMLTableSectionElement>(null);
  if (!rounds.length) return <p className="section-empty">第 1 轮参与方步骤完成后，这里列出每个参与方上传的内容。</p>;

  const active = cell ?? { datasetId: task.members[0].datasetId, round: rounds[rounds.length - 1] };
  const member = task.members.find((item) => item.datasetId === active.datasetId) ?? task.members[0];
  const count = task.rounds.find((record) => record.round === active.round)?.traces?.[member.datasetId] ?? 0;
  const allRounds = Array.from({ length: task.config.rounds }, (_, index) => index + 1).filter((round) => round <= Math.max(...rounds));

  function move(event: KeyboardEvent<HTMLButtonElement>, row: number, column: number) {
    const delta: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const step = delta[event.key];
    if (!step) return;
    event.preventDefault();
    const nextRow = Math.min(task.members.length - 1, Math.max(0, row + step[0]));
    const nextColumn = Math.min(allRounds.length - 1, Math.max(0, column + step[1]));
    setCell({ datasetId: task.members[nextRow].datasetId, round: allRounds[nextColumn] });
    grid.current?.querySelector<HTMLButtonElement>(`[data-cell="${nextRow}-${nextColumn}"]`)?.focus();
  }

  return (
    <div className="uploads">
      <div className="table-shell">
        <table className="table table--numbers">
          <caption className="visually-hidden">每个参与方每轮上传的条数，点数字查看内容；方向键在格子之间移动</caption>
          <thead>
            <tr>
              <th scope="col">参与方</th>
              {allRounds.map((round) => <th key={round} scope="col" className="numeric">第 {round} 轮</th>)}
            </tr>
          </thead>
          <tbody ref={grid}>
            {task.members.map((item, row) => (
              <tr key={item.datasetId}>
                <th scope="row">{item.participant}</th>
                {allRounds.map((round, column) => {
                  const value = task.rounds.find((record) => record.round === round)?.traces?.[item.datasetId] ?? 0;
                  const selected = active.datasetId === item.datasetId && active.round === round;
                  return (
                    <td key={round} className="numeric">
                      <button
                        type="button"
                        data-cell={`${row}-${column}`}
                        tabIndex={selected ? 0 : -1}
                        className={`cell-button${selected ? " cell-button--active" : ""}`}
                        aria-pressed={selected}
                        aria-label={`${item.participant} 第 ${round} 轮上传 ${value} 条，查看内容`}
                        onClick={() => setCell({ datasetId: item.datasetId, round })}
                        onKeyDown={(event) => move(event, row, column)}
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
        <p className="section-meta">共 {formatNumber(count)} 条，这里展示 {Math.min(SHOWN, count)} 条示例</p>
        <ol className="trace-list">
          {sampleTraceTexts(member.datasetId, active.round, Math.min(SHOWN, count)).map((trace) => (
            <li key={trace.key} lang="en">{trace.text}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
