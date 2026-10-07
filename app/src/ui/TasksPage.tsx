import { useState } from "react";
import { SCENARIOS } from "../domain/catalog";
import { TASK_STATUS, type Task, type TaskStatus } from "../domain/task";
import { showFlash } from "../state/flash";
import { hrefOf } from "../state/route";
import type { State } from "../state/store";
import { PageHead, PanelEmpty, SearchInput, Tag } from "./common";
import { DeleteTaskConfirm } from "./DeleteTaskConfirm";
import { Panel } from "./console";
import { TaskTypeSelect, type TaskTypeFilter } from "./filters";
import { Icon } from "./icons";
import { sortTasks } from "./labels";
import { TaskTable } from "./TaskTable";

type Filter = "all" | TaskStatus;

/**
 * 联邦任务：按场景分块（横向、纵向、迁移），每块列出这个场景下的任务，右上角是这个场景的"新建联邦任务"。
 * 新建时进的是这个场景自己的配置页，和首页点场景卡片进去的是同一页；规划中的场景按钮不可用。
 * 任务类型是第二层分类：表格里单独一列，上方可以按任务类型筛选；搜索和筛选对所有场景一起生效。
 */
export default function TasksPage({ state }: { state: State }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [taskType, setTaskType] = useState<TaskTypeFilter>("all");
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<Task | null>(null);
  const keyword = query.trim().toLowerCase();
  const filtered = sortTasks(state.tasks.filter((task) => (
    (filter === "all" || task.status === filter)
    && (taskType === "all" || task.config.taskType === taskType)
    && (!keyword || task.name.toLowerCase().includes(keyword))
  )));
  const filtering = filter !== "all" || taskType !== "all" || Boolean(keyword);
  const clear = () => { setQuery(""); setFilter("all"); setTaskType("all"); };

  return (
    <>
      <PageHead title="联邦任务" meta="配置协作任务，查看进度、比较效果并发布产出。" />
      {deleting ? <DeleteTaskConfirm task={deleting} onCancel={() => setDeleting(null)} onDeleted={() => { showFlash({ page: "tasks" }, `已删除任务“${deleting.name}”。`); setDeleting(null); }} /> : null}
      <div className="list-toolbar" role="search" aria-label="筛选联邦任务">
        <SearchInput
          name="task-search"
          aria-label="搜索任务名称"
          placeholder="搜索任务名称…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <TaskTypeSelect value={taskType} onChange={setTaskType} />
        <select name="task-status" aria-label="按状态筛选" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
          <option value="all">全部状态</option>
          {(Object.keys(TASK_STATUS) as TaskStatus[]).map((status) => <option key={status} value={status}>{TASK_STATUS[status]}</option>)}
        </select>
        {filtering ? <button type="button" className="button button--ghost button--compact" onClick={clear}>清除筛选</button> : null}
      </div>
      <div className="panel-stack">
        {SCENARIOS.map((scenario) => {
          const available = scenario.status === "available";
          const all = state.tasks.filter((task) => task.config.scenario === scenario.id);
          const tasks = filtered.filter((task) => task.config.scenario === scenario.id);
          return (
            <Panel
              key={scenario.id}
              id={`tasks-${scenario.id}`}
              className={available ? undefined : "panel--planned"}
              title={<>{scenario.name}{available ? null : <Tag>规划中</Tag>}</>}
              extra={available ? filtering ? `${tasks.length} / ${all.length} 个任务` : `${all.length} 个任务` : undefined}
              actions={available
                ? <a className="button button--primary button--compact" href={hrefOf({ page: "newTask", scenario: scenario.id })}><Icon name="plus" />新建联邦任务</a>
                : <button type="button" className="button button--secondary button--compact" disabled><Icon name="plus" />新建联邦任务</button>}
              flush
            >
              {tasks.length ? <TaskTable tasks={tasks} onDelete={setDeleting} /> : (
                <PanelEmpty>
                  {!available
                    ? "算法待接入，暂时不能新建任务。"
                    : all.length ? "没有符合条件的任务。" : `还没有${scenario.short}的任务，点右上角"新建联邦任务"开始。`}
                </PanelEmpty>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}
