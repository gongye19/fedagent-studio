import { useState } from "react";
import { algorithmsFor, recordTaskTypesFor, SCENARIOS, TASK_TYPES, visibleApplicationType } from "../domain/catalog";
import { hrefOf } from "../state/route";
import { PageHead, Tag } from "./common";
import { TaskTypeSelect, type TaskTypeFilter } from "./filters";
import { Icon } from "./icons";

/**
 * 算法：按场景分成三栏（横向、纵向、迁移），每栏列出这个场景下的算法，一眼看出每一类有哪些算法。
 * 任务类型是第二层分类：卡片上写出算法支持的任务类型，上方可以按任务类型筛选（和联邦任务、应用、参与方与数据一样）。
 * 每栏最后留一个"待接入"的空位，表示之后还会接入别的算法。点一个算法打开它的详情页。
 */
export default function AlgorithmsPage() {
  const [taskType, setTaskType] = useState<TaskTypeFilter>("all");
  const taskTypes = [...new Set(SCENARIOS.flatMap((scenario) => recordTaskTypesFor(scenario.id)))];
  return (
    <>
      <PageHead title="算法" meta="点开算法，查看架构流程、所需资源、参数与接入范围。" />
      {taskTypes.length > 1 ? <div className="list-toolbar">
        <TaskTypeSelect types={taskTypes} value={taskType} onChange={setTaskType} />
        {taskType !== "all" ? <button type="button" className="button button--ghost button--compact" onClick={() => setTaskType("all")}>清除筛选</button> : null}
      </div> : null}
      {/* 放得下时三栏并排，窄屏上下排，见 styles.css */}
      <div className="algo-board-shell">
        <div className="algo-board">
          {SCENARIOS.map((scenario) => {
            const all = algorithmsFor(scenario.id).filter((a) => a.accepts.some(visibleApplicationType));
            const algorithms = taskType === "all" ? all : all.filter(a => a.accepts.includes(taskType));
            return (
              <section key={scenario.id} className="algo-column" aria-labelledby={`algo-${scenario.id}`}>
                <header className="algo-column-head">
                  <h2 id={`algo-${scenario.id}`}>{scenario.name}</h2>
                  {scenario.status === "available" ? <span className="algo-count">{all.length} 个算法</span> : <Tag>规划中</Tag>}
                </header>
                <ul className="algo-list">
                  {algorithms.map((algorithm) => (
                    <li key={algorithm.id}>
                      <a className="algo-card" href={hrefOf({ page: "algorithms", id: algorithm.id })}>
                        <span className="algo-card-head">
                          <strong>{algorithm.name}</strong>
                          <Icon name="chevron" />
                        </span>
                        <span className="algo-card-full" translate="no">{algorithm.fullName}</span>
                        <span className="algo-card-text">{algorithm.summary}</span>
                        <span className="algo-card-facts">
                          <span><span className="algo-card-label">任务类型</span>{algorithm.accepts.filter(visibleApplicationType).map((type) => TASK_TYPES[type].label).join("、")}</span>
                          <span><span className="algo-card-label">产出</span>{algorithm.output.name}</span>
                        </span>
                      </a>
                    </li>
                  ))}
                  {all.length && !algorithms.length ? <li className="algo-empty">没有支持这个任务类型的算法。</li> : null}
                  <li>
                    <div className="algo-card algo-card--placeholder">
                      <span>{algorithms.length ? "更多算法" : "算法"}</span>
                      <span className="choice-badge">待接入</span>
                    </div>
                  </li>
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
