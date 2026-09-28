import { useState } from "react";
import { TASK_STATUS, type TaskStatus } from "../domain/task";
import { hrefOf } from "../state/route";
import type { State } from "../state/store";
import { EmptyState, PageHead, Section, Segmented } from "./common";
import { Icon } from "./icons";
import { sortTasks } from "./labels";
import { TaskTable } from "./TaskTable";

type Filter = "all" | TaskStatus;

/** 平台的使用流程，只在还没有任务时出现。 */
const STEPS: readonly { title: string; text: string }[] = [
  { title: "选场景和算法", text: "横向联邦用 FoT；纵向和迁移的算法规划中" },
  { title: "选数据", text: "一份数据代表一个参与方，题目和答案不离开持有方" },
  { title: "运行", text: "每轮各方解题、反思、上传 trace，服务端汇成洞见库下发" },
  { title: "看结果，用洞见库", text: "对比第 1 轮（本地）和最后一轮（联邦），发布后试用或导出" },
];

export default function TasksPage({ state }: { state: State }) {
  const [filter, setFilter] = useState<Filter>("all");
  const count = (status: TaskStatus) => state.tasks.filter((task) => task.status === status).length;
  const options: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "全部", count: state.tasks.length },
    ...(["running", "paused", "completed", "canceled"] as const)
      .filter((status) => count(status) > 0)
      .map((status) => ({ id: status, label: TASK_STATUS[status], count: count(status) })),
  ];
  const active: Filter = options.some((option) => option.id === filter) ? filter : "all";
  const tasks = sortTasks(active === "all" ? state.tasks : state.tasks.filter((task) => task.status === active));
  const create = <a className="button button--primary" href={hrefOf({ page: "newTask" })}><Icon name="plus" />新建联邦任务</a>;

  return (
    <>
      <PageHead title="联邦任务" actions={state.tasks.length ? create : null} />
      {state.tasks.length ? (
        <Section actions={options.length > 2 ? <Segmented label="按状态筛选" options={options} value={active} onChange={setFilter} /> : null}>
          <TaskTable tasks={tasks} />
        </Section>
      ) : (
        <EmptyState title="还没有联邦任务" action={create}>
          <ol className="usage-steps">
            {STEPS.map((step) => (
              <li key={step.title}>
                <strong>{step.title}</strong>
                <span>{step.text}</span>
              </li>
            ))}
          </ol>
        </EmptyState>
      )}
    </>
  );
}
