import { ALGORITHMS, algorithmsFor, SCENARIOS, TASK_TYPES } from "../domain/catalog";
import { PageHead, Tag } from "./common";
import { Panel } from "./console";

/** 算法：平台按注册表接入算法，每个算法声明适用场景、任务类型、交换内容和产出。 */
export default function AlgorithmsPage() {
  const planned = SCENARIOS.filter((scenario) => !algorithmsFor(scenario.id).length);
  return (
    <>
      <PageHead title="算法" meta="算法以插件接入平台：声明适用的场景和任务类型、各方交换什么、产出什么。" />
      <Panel flush>
        <div className="table-shell">
          <table className="table table--stack">
            <thead>
              <tr>
                <th scope="col">算法</th>
                <th scope="col">场景</th>
                <th scope="col">任务类型</th>
                <th scope="col">通信内容</th>
                <th scope="col">产出</th>
                <th scope="col">状态</th>
              </tr>
            </thead>
            <tbody>
              {ALGORITHMS.map((algorithm) => (
                <tr key={algorithm.id}>
                  <th scope="row">
                    <span className="cell-title">{algorithm.name}<span className="cell-note" translate="no">{algorithm.fullName}</span></span>
                    <small>{algorithm.summary} · <a className="text-link" href={algorithm.source.paperUrl} target="_blank" rel="noreferrer">论文</a></small>
                  </th>
                  <td data-label="场景">{SCENARIOS.find((scenario) => scenario.id === algorithm.scenario)?.short}</td>
                  <td data-label="任务类型">{algorithm.accepts.map((type) => TASK_TYPES[type].label).join("、")}</td>
                  <td data-label="通信内容">{algorithm.exchange}</td>
                  <td data-label="产出">{algorithm.output.name}</td>
                  <td data-label="状态"><span className="status-text">可用</span></td>
                </tr>
              ))}
              {planned.map((scenario) => (
                <tr key={scenario.id} className="row--muted">
                  <th scope="row">待接入</th>
                  <td data-label="场景">{scenario.short}</td>
                  <td data-label="任务类型">—</td>
                  <td data-label="通信内容">—</td>
                  <td data-label="产出">—</td>
                  <td data-label="状态"><Tag>规划中</Tag></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
