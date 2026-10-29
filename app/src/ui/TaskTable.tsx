import { TASK_TYPES } from "../domain/catalog";
import { averageAccuracy, canDeleteTask, evaluationLabel, scoreDifference, latestScoredRound, TASK_STATUS, type Task } from "../domain/task";
import { hrefOf } from "../state/route";
import { Tag } from "./common";
import { formatDate, formatDelta, formatPercent } from "./format";
import { algorithmOfTask, deltaClass, metricOf, stageText, statusTone } from "./labels";
import { ScenarioTag } from "./ScenarioTag";

/** 运行中、暂停、取消用标签提醒；已完成是常态，用普通文字。 */
export function TaskStatus({ task }: { task: Task }) {
  if (task.status === "completed") return <span className="status-text">已完成</span>;
  return <Tag tone={statusTone(task)} live={task.status === "running"}>{TASK_STATUS[task.status]}</Tag>;
}

/** 主要指标：第 1 轮（本地）→ 最新一轮（联邦）。指标名由任务类型决定。 */
export function MetricChange({ task }: { task: Task }) {
  const latest = latestScoredRound(task);
  if (!latest) return <span className="muted">—</span>;
  if (task.evaluationLabels?.length) {
    const local = averageAccuracy(task, 2), shared = averageAccuracy(task, 3);
    return shared === null ? <span>{formatPercent(averageAccuracy(task, latest))}<small>{evaluationLabel(task, latest)}</small></span>
      : <span><span className="nowrap">{formatPercent(local)} → {formatPercent(shared)}</span><small>本地 → 联邦 <span className={deltaClass(scoreDifference(task, 2, 3))}>{formatDelta(scoreDifference(task, 2, 3))}</span></small></span>;
  }
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

/** 场景、算法和任务类型各占一列；窄屏保留独立字段，改为卡片布局。 */
export function TaskTable({ tasks, onDelete }: { tasks: readonly Task[]; onDelete: (task: Task) => void }) {
  return (
    <div className="table-shell">
      <table className="table table--stack table--tasks">
        <thead>
          <tr>
            <th scope="col">任务名称</th>
            <th scope="col">场景</th>
            <th scope="col">算法</th>
            <th scope="col">任务类型</th>
            <th scope="col">状态</th>
            <th scope="col" className="numeric">主要指标</th>
            <th scope="col" className="numeric">开始时间</th>
            <th scope="col" className="numeric">操作</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const stage = stageText(task);
            return (
              <tr key={task.id}>
                <th scope="row">
                  <a className="table-link" href={hrefOf({ page: "task", id: task.id })}>{task.name}</a>
                </th>
                <td data-label="场景"><ScenarioTag scenario={task.config.scenario} /></td>
                <td data-label="算法">{algorithmOfTask(task).name}</td>
                <td data-label="任务类型">{TASK_TYPES[task.config.taskType].label}</td>
                <td className="task-status-cell" data-label="状态">
                  <div className="task-status-line">
                    <TaskStatus task={task} />
                    {stage ? <small>{stage}</small> : null}
                  </div>

                </td>
                <td className="numeric" data-label="主要指标"><MetricChange task={task} /></td>
                <td className="numeric nowrap" data-label="开始时间">{task.startedAt ? <time dateTime={task.startedAt}>{formatDate(task.startedAt)}</time> : <span className="muted">尚未开始</span>}</td>
                <td className="numeric" data-label="操作">
                  <button type="button" className="button button--ghost button--danger button--compact" disabled={!canDeleteTask(task)} title={canDeleteTask(task) ? undefined : "请先取消任务，结束后才能删除"} aria-label={`删除任务“${task.name}”`} onClick={() => onDelete(task)}>删除</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
