import { TASK_TYPES, type TaskType } from "../domain/catalog";

/** 列表页的任务类型筛选：联邦任务、应用、参与方与数据都用它，场景分块之外的第二层分类。 */
export type TaskTypeFilter = "all" | TaskType;

export function TaskTypeSelect({ value, onChange }: { value: TaskTypeFilter; onChange: (value: TaskTypeFilter) => void }) {
  return (
    <select name="task-type" aria-label="按任务类型筛选" value={value} onChange={(event) => onChange(event.target.value as TaskTypeFilter)}>
      <option value="all">全部任务类型</option>
      {(Object.keys(TASK_TYPES) as TaskType[]).map((type) => <option key={type} value={type}>{TASK_TYPES[type].label}</option>)}
    </select>
  );
}
