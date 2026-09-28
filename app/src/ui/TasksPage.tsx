import { useState } from "react";
import { TASK_STATUS, type TaskStatus } from "../domain/task";
import { hrefOf } from "../state/route";
import type { State } from "../state/store";
import { EmptyState, PageHead, Panel, Segmented } from "./common";
import { Icon } from "./icons";
import { TaskTable } from "./TaskTable";

type Filter = "all" | TaskStatus;

export default function TasksPage({ state }: { state: State }) {
  const [filter, setFilter] = useState<Filter>("all");
  const count = (status: TaskStatus) => state.tasks.filter((task) => task.status === status).length;
  const options: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "全部", count: state.tasks.length },
    ...(["running", "paused", "completed", "canceled"] as const).map((status) => ({ id: status, label: TASK_STATUS[status], count: count(status) })),
  ];
  const tasks = filter === "all" ? state.tasks : state.tasks.filter((task) => task.status === filter);

  return (
    <>
      <PageHead
        title="联邦任务"
        actions={<a className="button button--primary" href={hrefOf({ page: "newTask" })}><Icon name="plus" />新建联邦任务</a>}
      />
      <Panel
        flush
        title="任务列表"
        id="task-list"
        extra={<Segmented label="按状态筛选" options={options} value={filter} onChange={setFilter} />}
      >
        {tasks.length ? <TaskTable tasks={tasks} /> : (
          <EmptyState title={filter === "all" ? "还没有任务" : `没有${TASK_STATUS[filter as TaskStatus]}的任务`} />
        )}
      </Panel>
    </>
  );
}
