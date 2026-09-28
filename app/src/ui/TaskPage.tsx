import type { Dispatch } from "react";
import { stageOf } from "../domain/catalog";
import { toDraft } from "../domain/config";
import { progressOf, scoredRounds, type Task } from "../domain/task";
import { navigate, type TaskTab } from "../state/route";
import type { Action, State } from "../state/store";
import { Badge, PageHead, ProgressBar, TabLinks } from "./common";
import { formatDate } from "./format";
import { Icon } from "./icons";
import { stageText, taskSummary } from "./labels";
import { ConfigTab } from "./task/ConfigTab";
import { LibraryTab } from "./task/LibraryTab";
import { ProgressTab } from "./task/ProgressTab";
import { ResultsTab } from "./task/ResultsTab";
import { TaskStatus } from "./TaskTable";

type Props = { task: Task; state: State; dispatch: Dispatch<Action>; tab?: TaskTab };

export default function TaskPage({ task, state, dispatch, tab }: Props) {
  // 有结果就先看结果；还没有结果时看进度。
  const active: TaskTab = tab ?? (scoredRounds(task).length ? "results" : "progress");
  const tabs: { id: TaskTab; label: string }[] = [
    { id: "results", label: "结果" },
    { id: "progress", label: "进度" },
    { id: "library", label: "洞见库" },
    { id: "config", label: "配置" },
  ];

  function copy() {
    dispatch({ type: "resetDraft", draft: toDraft(task.config, `${task.name}（副本）`) });
    navigate({ page: "newTask" });
  }

  function cancel() {
    if (window.confirm("取消后任务停在当前步骤，不能再继续。确定取消？")) {
      dispatch({ type: "cancelTask", id: task.id, now: new Date().toISOString() });
    }
  }

  const running = task.status === "running";
  const paused = task.status === "paused";
  const actions = (
    <>
      {running ? <button type="button" className="button button--secondary" onClick={() => dispatch({ type: "pauseTask", id: task.id })}><Icon name="pause" />暂停</button> : null}
      {paused ? <button type="button" className="button button--secondary" onClick={() => dispatch({ type: "resumeTask", id: task.id })}><Icon name="play" />继续</button> : null}
      {running || paused ? <button type="button" className="button button--ghost" onClick={cancel}>取消任务</button> : null}
      <button type="button" className="button button--secondary" onClick={copy}><Icon name="copy" />复制为新任务</button>
    </>
  );

  const finished = task.finishedAt && task.status === "completed" ? ` · 完成于 ${formatDate(task.finishedAt)}` : "";
  return (
    <>
      <PageHead
        crumbs={[{ label: "联邦任务", route: { page: "tasks" } }]}
        title={task.name}
        status={<TaskStatus task={task} />}
        meta={`${taskSummary(task)} · ${task.config.rounds} 轮 · 创建于 ${formatDate(task.createdAt)}${finished}`}
        actions={actions}
      />
      {task.cursor && task.status !== "canceled" ? <LiveBanner task={task} /> : null}
      <TabLinks
        label="任务详情"
        tabs={tabs}
        active={active}
        routeOf={(id) => ({ page: "task", id: task.id, tab: id })}
        end={<Badge tone="sample">示例数据</Badge>}
      />
      <div className="tab-panel">
        {active === "results" ? <ResultsTab task={task} /> : null}
        {active === "progress" ? <ProgressTab key={task.id} task={task} /> : null}
        {active === "library" ? <LibraryTab key={task.id} task={task} state={state} dispatch={dispatch} /> : null}
        {active === "config" ? <ConfigTab task={task} state={state} /> : null}
      </div>
    </>
  );
}

/** 运行中或暂停的任务在标签上方显示总进度；读屏只播报步骤变化，不播报百分比。 */
function LiveBanner({ task }: { task: Task }) {
  const cursor = task.cursor;
  if (!cursor) return null;
  const progress = progressOf(task);
  const stage = stageText(task);
  return (
    <div className={`live-banner live-banner--${task.status}`}>
      <div className="live-copy">
        <strong>{stage}</strong>
        <small>{task.status === "paused" ? "已暂停，点“继续”从这一步接着运行" : stageOf(cursor.stage).detail}</small>
      </div>
      <ProgressBar value={progress} label="整体进度" tone={task.status === "running" ? "info" : "warning"} />
      <span className="live-percent" aria-hidden="true">{Math.round(progress * 100)}%</span>
      <span className="visually-hidden" aria-live="polite">{stage}</span>
    </div>
  );
}
