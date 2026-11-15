import { useState } from "react";
import { algorithmsFor, recordTaskTypesFor, SCENARIOS, TASK_TYPES, visibleApplicationType } from "../domain/catalog";
import { hrefOf } from "../state/route";
import { PageHead, Tag } from "./common";
import { TaskTypeSelect, type TaskTypeFilter } from "./filters";
import { Icon } from "./icons";

/** 目录仅呈现名称与适用任务；流程、规范和参数留在算法详情。 */
export default function AlgorithmsPage() {
  const [taskType, setTaskType] = useState<TaskTypeFilter>("all");
  const taskTypes = [...new Set(SCENARIOS.flatMap((scenario) => recordTaskTypesFor(scenario.id)))];
  return <>
    <PageHead title="算法" />
    {taskTypes.length > 1 ? <div className="list-toolbar">
      <TaskTypeSelect types={taskTypes} value={taskType} onChange={setTaskType} />
      {taskType !== "all" ? <button type="button" className="button button--ghost button--compact"
        onClick={() => setTaskType("all")}>清除筛选</button> : null}
    </div> : null}
    <div className="algo-board">
      {SCENARIOS.map((scenario) => {
        const all = algorithmsFor(scenario.id).filter((a) => a.accepts.some(visibleApplicationType));
        const algorithms = taskType === "all" ? all : all.filter((a) => a.accepts.includes(taskType));
        return <section key={scenario.id} className="algo-column" aria-labelledby={`algo-${scenario.id}`}>
          <header className="algo-column-head">
            <h2 id={`algo-${scenario.id}`}>{scenario.name}</h2>
            {all.length ? <span className="algo-count">{all.length} 个算法</span> : <Tag>待接入</Tag>}
          </header>
          {all.length ? <ul className="algo-list">
            {algorithms.map((algorithm) => <li key={algorithm.id}>
              <a className="algo-card" href={hrefOf({ page: "algorithms", id: algorithm.id })}>
                <div><strong>{algorithm.name}</strong>
                  <span>{algorithm.accepts.filter(visibleApplicationType).map((type) => TASK_TYPES[type].label).join("、")}
                    <span aria-hidden="true"> · </span>{algorithm.output.name}</span>
                </div>
                <Icon name="chevron" />
              </a>
            </li>)}
            {!algorithms.length ? <li className="algo-empty">没有支持这个任务类型的算法。</li> : null}
          </ul> : null}
        </section>;
      })}
    </div>
  </>;
}
