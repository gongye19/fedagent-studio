import { TASK_TYPES } from "../domain/catalog";
import { averageAccuracy, latestScoredRound, progressOf, TASK_STATUS, type Task } from "../domain/task";
import { hrefOf } from "../state/route";
import { Meta, ProgressBar, Tag } from "./common";
import { formatDate, formatDelta, formatPercent } from "./format";
import { deltaClass, metricOf, stageText, statusTone, taskSummaryParts } from "./labels";

/** 运行中、暂停、取消用标签提醒；已完成是常态，用普通文字。 */
export function TaskStatus({ task }: { task: Task }) {
  if (task.status === "completed") return <span className="status-text">已完成</span>;
  return <Tag tone={statusTone(task)} live={task.status === "running"}>{TASK_STATUS[task.status]}</Tag>;
}

/** 主要指标：第 1 轮（本地）→ 最新一轮（联邦）。指标名由任务类型决定。 */
export function MetricChange({ task }: { task: Task }) {
  const latest = latestScoredRound(task);
  if (!latest) return <span className="muted">—</span>;
  const first = averageAccuracy(task, 1);
  if (latest === 1) return <span>{formatPercent(first)}<small>{metricOf(task)} · 第 1 轮</small></span>;
  const last = averageAccuracy(task, latest);
  const delta = first !== null && last !== null ? last - first : null;
  return (
    <span>
      <span className="nowrap">{formatPercent(first)} → {formatPercent(last)}</span>
      <small>{metricOf(task)} <span className={deltaClass(delta)}>{formatDelta(delta)}</span></small>
    </span>
  );
}

/**
 * 任务表格，放在联邦任务页按场景分好的块里：任务类型单独一列（第二层分类），
 * 名称下面的摘要只写算法、参与方数和运行方式，不再重复场景和任务类型。
 */
export function TaskTable({ tasks }: { tasks: readonly Task[] }) {
  return (
    <div className="table-shell">
      <table className="table table--stack">
        <thead>
          <tr>
            <th scope="col">任务</th>
            <th scope="col">任务类型</th>
            <th scope="col">状态</th>
            <th scope="col" className="numeric">主要指标（本地 → 联邦）</th>
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
                  <small><Meta parts={taskSummaryParts(task, { withCategory: false })} /></small>
                </th>
                <td data-label="任务类型">{TASK_TYPES[task.config.taskType].label}</td>
                <td className="progress-cell" data-label="状态">
                  <div className="progress-line">
                    <TaskStatus task={task} />
                    {stage ? <small>{stage}</small> : null}
                  </div>
                  {task.cursor && task.status !== "canceled" ? (
                    <ProgressBar value={progressOf(task)} label={`${task.name} 的进度`} tone={task.status === "running" ? "info" : "warning"} />
                  ) : null}
                </td>
                <td className="numeric" data-label="主要指标"><MetricChange task={task} /></td>
                <td className="numeric nowrap" data-label="创建时间">{formatDate(task.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
