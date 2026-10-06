import { useState } from "react";
import { ApiError } from "../api/client";
import type { Task } from "../domain/task";
import { deleteTask } from "../state/actions";
import { Confirm, Notice } from "./common";

export function DeleteTaskConfirm({ task, onCancel, onDeleted }: { task: Task; onCancel: () => void; onDeleted: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  async function remove() {
    setProblem(null);
    try {
      await deleteTask(task.id);
      onDeleted();
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "删除失败，稍后再试");
    }
  }
  return (
    <>
      <Confirm title={`删除“${task.name}”？`} confirmLabel="删除任务" onConfirm={remove} onCancel={onCancel}>
        任务配置、结果和运行记录将永久删除，不能撤销。参与方、数据集、已发布应用和模型费用账本会保留。
      </Confirm>
      {problem ? <Notice tone="warning">{problem}</Notice> : null}
    </>
  );
}
