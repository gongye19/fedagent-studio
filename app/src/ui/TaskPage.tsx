import { useState, type Dispatch } from "react";
import { toDraft } from "../domain/config";
import { progressOf, scoredRounds, type Task } from "../domain/task";
import { navigate, type TaskTab } from "../state/route";
import type { Action, State } from "../state/store";
import { Confirm, Meta, PageHead, ProgressBar, TabLinks } from "./common";
import { formatDate } from "./format";
import { Icon } from "./icons";
import { stageText, taskSummaryParts } from "./labels";
import { ConfigTab } from "./task/ConfigTab";
import { OutputTab } from "./task/OutputTab";
import { OverviewTab } from "./task/OverviewTab";
import { ProgressTab } from "./task/ProgressTab";
import { TaskStatus } from "./TaskTable";

type Props = { task: Task; state: State; dispatch: Dispatch<Action>; tab?: TaskTab };

export default function TaskPage({ task, state, dispatch, tab }: Props) {
  const [canceling, setCanceling] = useState(false);
  // 有结果就先看概览；还没有结果时看进度。
  const active: TaskTab = tab ?? (scoredRounds(task).length ? "overview" : "progress");
  const tabs: { id: TaskTab; label: string }[] = [
    { id: "overview", label: "概览" },
    { id: "progress", label: "进度" },
    { id: "output", label: "产出" },
    { id: "config", label: "配置" },
  ];

  function copy() {
    dispatch({ type: "resetDraft", draft: toDraft(task.config, `${task.name}（副本）`) });
    navigate({ page: "newTask", scenario: task.config.scenario });
  }

  function cancel() {
    setCanceling(false);
    dispatch({ type: "cancelTask", id: task.id, now: new Date().toISOString() });
  }

  const running = task.status === "running";
  const paused = task.status === "paused";
  const actions = (
    <>
      {running ? <button type="button" className="button button--secondary" onClick={() => dispatch({ type: "pauseTask", id: task.id })}><Icon name="pause" />暂停</button> : null}
      {paused ? <button type="button" className="button button--secondary" onClick={() => dispatch({ type: "resumeTask", id: task.id })}><Icon name="play" />继续</button> : null}
      <button type="button" className="button button--secondary" onClick={copy}><Icon name="copy" />复制为新任务</button>
      {(running || paused) && !canceling ? <button type="button" className="button button--secondary button--danger" onClick={() => setCanceling(true)}>取消任务</button> : null}
    </>
  );

  return (
    <>
      <PageHead
        crumbs={[{ label: "联邦任务", route: { page: "tasks" } }]}
        title={task.name}
        status={<TaskStatus task={task} />}
        meta={<Meta parts={[
          ...taskSummaryParts(task),
          `${task.config.rounds} 轮`,
          `创建于 ${formatDate(task.createdAt)}`,
          task.finishedAt && task.status === "completed" ? `完成于 ${formatDate(task.finishedAt)}` : null,
        ]} />}
        actions={actions}
      />
      {canceling && (running || paused) ? (
        <Confirm title="取消这个任务？" confirmLabel="取消任务" cancelLabel="返回" onConfirm={cancel} onCancel={() => setCanceling(false)}>
          取消后任务停在当前步骤，不能再继续；已经生成的结果和产出会保留。
        </Confirm>
      ) : null}
      <TabLinks label="任务详情" tabs={tabs} active={active} routeOf={(id) => ({ page: "task", id: task.id, tab: id })} />
      {task.cursor && task.status !== "canceled" ? <LiveBanner task={task} /> : null}
      <div className="tab-panel">
        {active === "overview" ? <OverviewTab task={task} state={state} /> : null}
        {active === "progress" ? <ProgressTab key={task.id} task={task} /> : null}
        {active === "output" ? <OutputTab key={task.id} task={task} state={state} dispatch={dispatch} /> : null}
        {active === "config" ? <ConfigTab task={task} state={state} /> : null}
      </div>
    </>
  );
}

/** 运行中或暂停的任务在标签下方显示当前步骤和总进度；读屏只播报步骤变化，不播报百分比。 */
function LiveBanner({ task }: { task: Task }) {
  const progress = progressOf(task);
  const stage = stageText(task);
  const paused = task.status === "paused";
  return (
    <div className={`live-banner live-banner--${task.status}`}>
      <strong className="live-copy">{stage}{paused ? " · 已暂停" : ""}</strong>
      <ProgressBar value={progress} label="整体进度" tone={paused ? "warning" : "info"} />
      <span className="live-percent" aria-hidden="true">{Math.round(progress * 100)}%</span>
      <span className="visually-hidden" aria-live="polite">{stage}</span>
    </div>
  );
}
