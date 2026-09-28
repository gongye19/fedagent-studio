import { averageAccuracy, latestScoredRound, progressOf, TASK_STATUS, type Task } from "../domain/task";
import { hrefOf } from "../state/route";
import { ProgressBar, StatusPill } from "./common";
import { formatDate, formatDelta, formatPercent } from "./format";
import { deltaClass, stageText, statusTone, taskSummary } from "./labels";

/** 运行中、暂停、取消用胶囊提醒；已完成是常态，用普通文字。 */
export function TaskStatus({ task }: { task: Task }) {
  if (task.status === "completed") return <span className="status-text">已完成</span>;
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
    <div className="table-shell">
      <table className="table table--stack">
        <thead>
          <tr>
            <th scope="col">任务</th>
            <th scope="col">状态</th>
            <th scope="col" className="numeric">平均准确率</th>
            <th scope="col" className="numeric">创建时间</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const stage = stageText(task);
            return (
              <tr key={task.id}>
                <th scope="row">
                  <a className="table-link" href={hrefOf({ page: "task", id: task.id })}>{task.name}</a>
                  <small>{taskSummary(task)}</small>
                </th>
                <td className="progress-cell" data-label="状态">
                  <div className="progress-line">
                    <TaskStatus task={task} />
                    {stage ? <small>{stage}</small> : null}
                  </div>
                  {task.cursor && task.status !== "canceled" ? (
                    <ProgressBar value={progressOf(task)} label={`${task.name} 的进度`} tone={task.status === "running" ? "info" : "warning"} />
                  ) : null}
                </td>
                <td className="numeric" data-label="平均准确率"><AccuracyChange task={task} /></td>
                <td className="numeric nowrap" data-label="创建时间">{formatDate(task.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
