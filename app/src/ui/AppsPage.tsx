import { useState } from "react";
import { algorithmOf, SCENARIOS, TASK_TYPES } from "../domain/catalog";
import { outputs } from "../domain/task";
import { hrefOf } from "../state/route";
import { taskOf, type Published, type State } from "../state/store";
import { PageHead, PanelEmpty, SearchInput, Tag } from "./common";
import { Panel } from "./console";
import { TaskTypeSelect, type TaskTypeFilter } from "./filters";
import { formatDate } from "./format";

/**
 * 应用：任务的产出发布后的成果，可以直接试用，也可以接入自己的 Agent。
 * 和联邦任务一样按场景分块（横向、纵向、迁移），任务类型是第二层分类：表格里单独一列，上方可以按任务类型筛选。
 * 分类来自发布时记下的来源任务，来源任务删掉了也还在原来的类别里。
 */
export default function AppsPage({ state }: { state: State }) {
  const [taskType, setTaskType] = useState<TaskTypeFilter>("all");
  const [query, setQuery] = useState("");
  const keyword = query.trim().toLowerCase();
  const filtered = state.published.filter((item) => (
    (taskType === "all" || item.taskType === taskType) && (!keyword || item.name.toLowerCase().includes(keyword))
  ));
  const filtering = taskType !== "all" || Boolean(keyword);

  return (
    <>
      <PageHead title="应用" meta="试用已发布的任务产出，或接入自己的 Agent。" />
      <div className="list-toolbar" role="search" aria-label="筛选应用">
        <SearchInput
          name="app-search"
          aria-label="搜索应用名称"
          placeholder="搜索应用名称…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <TaskTypeSelect value={taskType} onChange={setTaskType} />
        {filtering ? <button type="button" className="button button--ghost button--compact" onClick={() => { setQuery(""); setTaskType("all"); }}>清除筛选</button> : null}
      </div>
      <div className="panel-stack">
        {SCENARIOS.map((scenario) => {
          const available = scenario.status === "available";
          const all = state.published.filter((item) => item.scenario === scenario.id);
          const items = filtered.filter((item) => item.scenario === scenario.id);
          return (
            <Panel
              key={scenario.id}
              id={`apps-${scenario.id}`}
              className={available ? undefined : "panel--planned"}
              title={<>{scenario.name}{available ? null : <Tag>规划中</Tag>}</>}
              extra={available ? filtering ? `${items.length} / ${all.length} 个应用` : `${all.length} 个应用` : undefined}
              flush
            >
              {items.length ? <AppTable state={state} items={items} /> : (
                <PanelEmpty>
                  {!available
                    ? "算法待接入，暂无应用。"
                    : all.length ? "没有符合条件的应用。" : `还没有${scenario.short}的应用。在任务详情的"产出"里，把一版产出发布为应用。`}
                </PanelEmpty>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}

/** 一个场景下的应用：名称（条数和版本）、任务类型、产出、来源任务、发布时间。 */
function AppTable({ state, items }: { state: State; items: readonly Published[] }) {
  return (
    <div className="table-shell">
      <table className="table table--stack">
        <thead>
          <tr>
            <th scope="col">应用</th>
            <th scope="col">任务类型</th>
            <th scope="col">产出</th>
            <th scope="col">来源任务</th>
            <th scope="col" className="numeric">发布时间</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const task = taskOf(state, item.taskId);
            const version = task ? outputs(task).find((output) => output.builtAfterRound === item.builtAfterRound) : undefined;
            const algorithm = algorithmOf(item.algorithm);
            return (
              <tr key={item.id}>
                <th scope="row">
                  <a className="table-link" href={hrefOf({ page: "app", id: item.id })}>{item.name}</a>
                  <small>{version ? `${version.items.length} 条 · 第 ${item.builtAfterRound} 轮后` : `第 ${item.builtAfterRound} 轮后`}</small>
                </th>
                <td data-label="任务类型">{TASK_TYPES[item.taskType].label}</td>
                <td data-label="产出">{algorithm.output.name}<small>{algorithm.name}</small></td>
                <td data-label="来源任务">{task ? <a className="text-link" href={hrefOf({ page: "task", id: task.id })}>{task.name}</a> : "任务已删除"}</td>
                <td className="numeric nowrap" data-label="发布时间">{formatDate(item.publishedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
