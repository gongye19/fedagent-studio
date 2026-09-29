import { useState } from "react";
import { TASK_STATUS, type TaskStatus } from "../domain/task";
import { hrefOf } from "../state/route";
import type { State } from "../state/store";
import { EmptyState, PageHead, PanelEmpty } from "./common";
import { Panel } from "./console";
import { Icon } from "./icons";
import { sortTasks } from "./labels";
import { TaskTable } from "./TaskTable";

type Filter = "all" | TaskStatus;

export default function TasksPage({ state }: { state: State }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const create = <a className="button button--primary" href={hrefOf({ page: "newTask" })}><Icon name="plus" />新建联邦任务</a>;
  const keyword = query.trim().toLowerCase();
  const tasks = sortTasks(state.tasks.filter((task) => (
    (filter === "all" || task.status === filter) && (!keyword || task.name.toLowerCase().includes(keyword))
  )));

  // 联邦任务是什么：放在列表页标题下，用户第一次看到这个词的地方。
  const meta = "每个联邦任务让多个参与方的 Agent 按选定的场景、任务类型和算法协作几轮；完成后对比各方效果，产出可以发布为应用。";
  if (!state.tasks.length) {
    return (
      <>
        <PageHead title="联邦任务" meta={meta} />
        <EmptyState title="还没有联邦任务" action={create}>
          <p>选择场景、算法和参与方，几步就能创建一个任务。</p>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHead title="联邦任务" meta={meta} actions={create} />
      <Panel flush>
        <div className="panel-toolbar">
          <input
            type="search"
            name="task-search"
            autoComplete="off"
            aria-label="搜索任务名称"
            placeholder="搜索任务名称…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select name="task-status" aria-label="按状态筛选" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
            <option value="all">全部状态</option>
            {(Object.keys(TASK_STATUS) as TaskStatus[]).map((status) => <option key={status} value={status}>{TASK_STATUS[status]}</option>)}
          </select>
          <span className="panel-extra">共 {tasks.length} 个</span>
        </div>
        {tasks.length ? <TaskTable tasks={tasks} /> : (
          <PanelEmpty action={<button type="button" className="button button--secondary button--compact" onClick={() => { setQuery(""); setFilter("all"); }}>清除筛选</button>}>
            没有符合条件的任务。
          </PanelEmpty>
        )}
      </Panel>
    </>
  );
}
