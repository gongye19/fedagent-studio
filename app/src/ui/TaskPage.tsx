import { useState, type Dispatch } from "react";
import { ApiError } from "../api/client";
import { toDraft } from "../domain/config";
import { canDeleteTask, progressOf, scoredRounds, type Task } from "../domain/task";
import { controlTask } from "../state/actions";
import { navigate, type TaskTab } from "../state/route";
import type { Action, State } from "../state/store";
import { Confirm, Meta, Notice, PageHead, ProgressBar, TabLinks, Tag } from "./common";
import { formatDate } from "./format";
import { Icon } from "./icons";
import { stageText, taskSummaryParts } from "./labels";
import { ConfigTab } from "./task/ConfigTab";
import { OutputTab } from "./task/OutputTab";
import { OverviewTab } from "./task/OverviewTab";
import { ProgressTab } from "./task/ProgressTab";
import { TaskStatus } from "./TaskTable";
import { DeleteTaskConfirm } from "./DeleteTaskConfirm";
import { showFlash } from "../state/flash";

type Props = { task: Task; state: State; dispatch: Dispatch<Action>; tab?: TaskTab };

export default function TaskPage({ task, state, dispatch, tab }: Props) {
  const [canceling, setCanceling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
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

  async function control(action: "pause" | "resume" | "cancel") {
    setBusy(true);
    setProblem(null);
    try {
      await controlTask(task.id, action);
    } catch (error) {
      if (action === "cancel") throw error;
      setProblem(error instanceof ApiError ? error.message : "操作失败，稍后再试");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    await control("cancel");
    setCanceling(false);
    showFlash({ page: "task", id: task.id }, "已取消任务，已生成的结果和产出会保留。");
  }

  // 排队中的任务也可以暂停、取消；暂停命令发出后，任务做完手上的样本才停下。
  const running = task.status === "running" || task.status === "queued";
  const paused = task.status === "paused";
  const actions = (
    <>
      {running ? <button type="button" className="button button--secondary" disabled={busy} onClick={() => void control("pause")}><Icon name="pause" />暂停</button> : null}
      {paused ? <button type="button" className="button button--secondary" disabled={busy} onClick={() => void control("resume")}><Icon name="play" />继续</button> : null}
      <button type="button" className="button button--secondary" disabled={busy} onClick={copy}><Icon name="copy" />复制为新任务</button>
      {(running || paused) ? <button type="button" className="button button--secondary button--danger" disabled={busy} onClick={() => { setProblem(null); setCanceling(true); }}>取消任务</button> : null}
      {canDeleteTask(task) ? <button type="button" className="button button--secondary button--danger" disabled={busy} onClick={() => setDeleting(true)}>删除任务</button> : null}
    </>
  );

  return (
    <>
      <PageHead
        crumbs={[{ label: "联邦任务", route: { page: "tasks" } }]}
        title={task.name}
        status={<>{task.fake ? <Tag>假模型</Tag> : null}<TaskStatus task={task} /></>}
        meta={<Meta parts={[
          ...taskSummaryParts(task),
          `${task.config.rounds} 轮`,
          `创建于 ${formatDate(task.createdAt)}`,
          task.finishedAt && task.status === "completed" ? `完成于 ${formatDate(task.finishedAt)}` : null,
        ]} />}
        actions={actions}
      />
      {paused && task.error ? <Notice tone="warning">任务已暂停：{task.error}</Notice> : null}
      {problem ? <Notice tone="warning" onDismiss={() => setProblem(null)}>{problem}</Notice> : null}
      {deleting ? <DeleteTaskConfirm task={task} onCancel={() => setDeleting(false)} onDeleted={() => { showFlash({ page: "tasks" }, `已删除任务“${task.name}”。`); navigate({ page: "tasks" }); }} /> : null}
      {canceling && (running || paused) ? (
        <Confirm title="取消这个任务？" confirmLabel="取消任务" cancelLabel="返回" onConfirm={cancel} onCancel={() => setCanceling(false)}>
          取消后任务停在当前步骤，不能再继续；已经生成的结果和产出会保留。
        </Confirm>
      ) : null}
      <TabLinks label="任务详情" tabs={tabs} active={active} routeOf={(id) => ({ page: "task", id: task.id, tab: id })} />
      {task.cursor && (running || paused) ? <LiveBanner task={task} /> : null}
      <div className="tab-panel">
        {active === "overview" ? <OverviewTab task={task} state={state} /> : null}
        {active === "progress" ? <ProgressTab key={task.id} task={task} /> : null}
        {active === "output" ? <OutputTab key={task.id} task={task} state={state} /> : null}
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
  const queued = task.status === "queued";
  return (
    <div className={`live-banner live-banner--${task.status}`}>
      <strong className="live-copy">{queued ? "排队中，等前面的任务完成后开始" : `${stage}${paused ? " · 已暂停" : ""}`}</strong>
      <ProgressBar value={progress} label="步骤完成进度" tone={paused ? "warning" : "info"} />
      <span className="live-percent" title="按已完成步骤及样本计算" aria-hidden="true">{Math.round(progress * 100)}%</span>
      <span className="visually-hidden" aria-live="polite">{stage}</span>
    </div>
  );
}
