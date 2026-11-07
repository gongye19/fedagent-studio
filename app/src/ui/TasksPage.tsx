import { MEDICAL_RECORDS } from "../domain/consultation";
import { SelectField } from "./SelectField";
import { useState } from "react";
import { TASK_STATUS, type Task, type TaskStatus } from "../domain/task";
import { showFlash } from "../state/flash";
import { hrefOf } from "../state/route";
import type { State } from "../state/store";
import { PageHead, PanelEmpty, SearchInput } from "./common";
import { DeleteTaskConfirm } from "./DeleteTaskConfirm";
import { Panel } from "./console";
import { Icon } from "./icons";
import { sortTasks } from "./labels";
import { TaskTable } from "./TaskTable";

type Filter = "all" | TaskStatus;

/** 所有任务统一展示，场景只作标签；搜索、筛选与删除共用同一列表。 */
export default function TasksPage({ state }: { state: State }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<Task | null>(null);
  const keyword = query.trim().toLowerCase();
  const medical = state.tasks.filter((task) => task.config.taskType === MEDICAL_RECORDS);
  const filtered = sortTasks(medical.filter((task) => (
    (filter === "all" || task.status === filter)
    && (!keyword || task.name.toLowerCase().includes(keyword))
  )));
  const filtering = filter !== "all" || Boolean(keyword);
  const clear = () => { setQuery(""); setFilter("all"); };

  return (
    <>
      <PageHead title="经验任务" meta="配置协作任务，查看进度、比较效果并发布产出。" actions={
        <a className="button button--primary" href={hrefOf({ page: "newTask" })}><Icon name="plus" />生成经验包</a>
      } />
      {deleting ? <DeleteTaskConfirm task={deleting} onCancel={() => setDeleting(null)} onDeleted={() => { showFlash({ page: "tasks" }, `已删除任务“${deleting.name}”。`); setDeleting(null); }} /> : null}
      <div className="list-toolbar" role="search" aria-label="筛选经验任务">
        <SearchInput
          name="task-search"
          aria-label="搜索任务名称"
          placeholder="搜索任务名称…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
          <SelectField name="task-status" aria-label="按状态筛选" value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <option value="all">全部状态</option>
          {(Object.keys(TASK_STATUS) as TaskStatus[]).map((status) => <option key={status} value={status}>{TASK_STATUS[status]}</option>)}
        </SelectField>
        {filtering ? <button type="button" className="button button--ghost button--compact" onClick={clear}>清除筛选</button> : null}
      </div>
      <Panel title="全部任务" extra={filtering ? `${filtered.length} / ${medical.length} 个任务` : `${medical.length} 个任务`} flush>
        {filtered.length ? <TaskTable tasks={filtered} onDelete={setDeleting} /> : (
          <PanelEmpty>{medical.length ? "没有符合条件的任务。" : "还没有任务，点击右上角“生成经验包”开始。"}</PanelEmpty>
        )}
      </Panel>
    </>
  );
}
