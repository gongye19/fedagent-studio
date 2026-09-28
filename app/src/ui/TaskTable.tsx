import { averageAccuracy, latestScoredRound, progressOf, TASK_STATUS, type Task } from "../domain/task";
import { hrefOf } from "../state/route";
import { ProgressBar, StatusPill } from "./common";
import { formatDate, formatDelta, formatPercent } from "./format";
import { deltaClass, stageText, statusTone, taskSummary } from "./labels";

export function TaskStatus({ task }: { task: Task }) {
  return <StatusPill tone={statusTone(task)} live={task.status === "running"}>{TASK_STATUS[task.status]}</StatusPill>;
}

/** 平均准确率：第 1 轮（本地）→ 最新一轮（联邦）。 */
export function AccuracyChange({ task }: { task: Task }) {
  const latest = latestScoredRound(task);
  if (!latest) return <span className="muted">—</span>;
  const first = averageAccuracy(task, 1);
  if (latest === 1) return <span>{formatPercent(first)}<small>第 1 轮</small></span>;
  const last = averageAccuracy(task, latest);
  const delta = first !== null && last !== null ? last - first : null;
  return (
    <span>
      {formatPercent(first)} → {formatPercent(last)}
      <small className={deltaClass(delta)}>{formatDelta(delta)}</small>
    </span>
  );
}

export function TaskTable({ tasks }: { tasks: readonly Task[] }) {
  return (
    <div className="table-wrap">
      <table className="table table--stack">
        <thead>
          <tr>
            <th scope="col">任务</th>
            <th scope="col">进度</th>
            <th scope="col" className="numeric">平均准确率</th>
            <th scope="col">创建时间</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td>
                <a className="table-link" href={hrefOf({ page: "task", id: task.id })}>{task.name}</a>
                <small>{taskSummary(task)}</small>
              </td>
              <td className="progress-cell">
                <div className="progress-line">
                  <TaskStatus task={task} />
                  <small>{stageText(task)}</small>
                </div>
                {task.cursor ? <ProgressBar value={progressOf(task)} label={`${task.name} 的进度`} tone={task.status === "running" ? "info" : "neutral"} /> : null}
              </td>
              <td className="numeric" data-label="平均准确率"><AccuracyChange task={task} /></td>
              <td className="nowrap" data-label="创建时间">{formatDate(task.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
