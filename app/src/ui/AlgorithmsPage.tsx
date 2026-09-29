import { algorithmsFor, SCENARIOS, TASK_TYPES } from "../domain/catalog";
import { hrefOf } from "../state/route";
import { PageHead, Tag } from "./common";
import { Icon } from "./icons";

/**
 * 算法：按场景分成三栏（横向、纵向、迁移），每栏列出这个场景下的算法，一眼看出每一类有哪些算法。
 * 每栏最后留一个"待接入"的空位，表示之后还会接入别的算法。点一个算法打开它的详情页。
 */
export default function AlgorithmsPage() {
  return (
    <>
      <PageHead title="算法" meta="每个算法只属于一个场景。点开一个算法，看它每轮做什么、有哪些参数、出自哪里。" />
      {/* 放得下时三栏并排，窄屏上下排，见 styles.css */}
      <div className="algo-board-shell">
        <div className="algo-board">
          {SCENARIOS.map((scenario) => {
            const algorithms = algorithmsFor(scenario.id);
            return (
              <section key={scenario.id} className="algo-column" aria-labelledby={`algo-${scenario.id}`}>
                <header className="algo-column-head">
                  <h2 id={`algo-${scenario.id}`}>{scenario.name}</h2>
                  {scenario.status === "available" ? <span className="algo-count">{algorithms.length} 个算法</span> : <Tag>规划中</Tag>}
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
                          <span><span className="algo-card-label">任务类型</span>{algorithm.accepts.map((type) => TASK_TYPES[type].label).join("、")}</span>
                          <span><span className="algo-card-label">产出</span>{algorithm.output.name}</span>
                        </span>
                      </a>
                    </li>
                  ))}
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
