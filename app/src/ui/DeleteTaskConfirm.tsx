import type { Task } from "../domain/task";
import { deleteTask } from "../state/actions";
import { Confirm } from "./common";

export function DeleteTaskConfirm({ task, onCancel, onDeleted }: { task: Task; onCancel: () => void; onDeleted: () => void }) {
  return (
    <Confirm title={`删除“${task.name}”？`} confirmLabel="删除任务" onConfirm={async () => { await deleteTask(task.id); onDeleted(); }} onCancel={onCancel}>
      任务配置、结果和运行记录将永久删除，不能撤销。参与方、数据集、已发布应用和模型费用账本会保留。
    </Confirm>
  );
}
