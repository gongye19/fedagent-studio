import type { Dispatch } from "react";
import { stageOf } from "../domain/catalog";
import { toDraft } from "../domain/config";
import { libraries, progressOf, type Task } from "../domain/task";
import { navigate, type TaskTab } from "../state/route";
import type { Action, State } from "../state/store";
import { PageHead, ProgressBar, TabLinks } from "./common";
import { formatDate } from "./format";
import { Icon } from "./icons";
import { ConfigTab } from "./task/ConfigTab";
import { LibraryTab } from "./task/LibraryTab";
import { ProgressTab } from "./task/ProgressTab";
import { ResultsTab } from "./task/ResultsTab";
import { UploadsTab } from "./task/UploadsTab";
import { stageText, taskSummary } from "./labels";
import { TaskStatus } from "./TaskTable";

type Props = { task: Task; state: State; dispatch: Dispatch<Action>; tab?: TaskTab };

export default function TaskPage({ task, state, dispatch, tab }: Props) {
  const active: TaskTab = tab ?? (task.status === "completed" ? "results" : "progress");
  const versions = libraries(task).length;
  const tabs: { id: TaskTab; label: string }[] = [
    { id: "results", label: "结果" },
    { id: "progress", label: "进度" },
    { id: "library", label: versions ? `洞见库 · ${versions} 版` : "洞见库" },
    { id: "uploads", label: "上传记录" },
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

  const actions = (
    <>
      {task.status === "running" ? (
        <button type="button" className="button button--secondary" onClick={() => dispatch({ type: "pauseTask", id: task.id })}><Icon name="pause" />暂停</button>
      ) : null}
      {task.status === "paused" ? (
        <button type="button" className="button button--secondary" onClick={() => dispatch({ type: "resumeTask", id: task.id })}><Icon name="play" />继续</button>
      ) : null}
      {task.status === "running" || task.status === "paused" ? (
        <button type="button" className="button button--secondary" onClick={cancel}><Icon name="stop" />取消</button>
      ) : null}
      <button type="button" className="button button--secondary" onClick={copy}><Icon name="copy" />复制为新任务</button>
    </>
  );

  return (
    <>
      <PageHead
        crumbs={[{ label: "联邦任务", route: { page: "tasks" } }]}
        title={task.name}
        status={<TaskStatus task={task} />}
        meta={`${taskSummary(task)} · ${task.config.rounds} 轮 · 创建于 ${formatDate(task.createdAt)}`}
        actions={actions}
      />
      {task.cursor ? <LiveBanner task={task} /> : null}
      <TabLinks label="任务详情" tabs={tabs} active={active} routeOf={(id) => ({ page: "task", id: task.id, tab: id })} />
      <div className="tab-panel">
        {active === "results" ? <ResultsTab task={task} /> : null}
        {active === "progress" ? <ProgressTab task={task} /> : null}
        {active === "library" ? <LibraryTab key={task.id} task={task} state={state} dispatch={dispatch} /> : null}
        {active === "uploads" ? <UploadsTab key={task.id} task={task} /> : null}
        {active === "config" ? <ConfigTab task={task} state={state} /> : null}
      </div>
    </>
  );
}

function LiveBanner({ task }: { task: Task }) {
  const cursor = task.cursor;
  if (!cursor) return null;
  const progress = progressOf(task);
  const title = task.status === "running" ? "运行中" : task.status === "paused" ? "已暂停" : "已取消";
  return (
    <div className={`live-banner live-banner--${task.status}`} aria-live="polite">
      <div className="live-copy">
        <strong>{title} · {stageText(task)}</strong>
        <small>{stageOf(cursor.stage).detail}</small>
      </div>
      <ProgressBar value={progress} label="整体进度" tone={task.status === "running" ? "info" : task.status === "paused" ? "warning" : "neutral"} />
      <span className="live-percent">{Math.round(progress * 100)}%</span>
    </div>
  );
}
