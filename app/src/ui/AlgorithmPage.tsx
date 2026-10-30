import { defaultParams, paramText, scenarioOf, TASK_TYPES, type Algorithm } from "../domain/catalog";
import { Collapsible, Facts, Meta, PageHead, Tag } from "./common";
import { Panel } from "./console";
import { AlgorithmFlow } from "./algorithm/AlgorithmFlow";
import { AlgorithmContract } from "./algorithm/AlgorithmContract";

/** 算法详情组合注册表信息与独立流程说明，不触发任务执行。 */
export default function AlgorithmPage({ algorithm }: { algorithm: Algorithm }) {
  const defaults = defaultParams(algorithm);
  return (
    <>
      <PageHead
        back={{ label: "算法列表", route: { page: "algorithms" } }}
        title={algorithm.name}
        status={<Tag>{scenarioOf(algorithm.scenario).name}</Tag>}
        meta={algorithm.summary}
      />
      <div className="panel-stack">
        <AlgorithmFlow algorithm={algorithm} />
        <AlgorithmContract algorithm={algorithm} />
        <Collapsible title="参数">
          <div className="panel-stack">
            <Panel title="概况">
              <Facts className="facts--columns" items={[
                ["全称", <span key="full" translate="no">{algorithm.fullName}</span>],
                ["场景", scenarioOf(algorithm.scenario).name],
                ["任务类型", algorithm.accepts.map((type) => TASK_TYPES[type].label).join("、")],
                ["通信内容", algorithm.exchange],
                ["产出", algorithm.output.name],
                ["参与方数量", `合计至少 ${algorithm.minParticipants} 方`],
                [algorithm.evaluationLabels?.length ? "评测" : "轮次", <Meta key="rounds" parts={algorithm.evaluationLabels?.length ? [...algorithm.evaluationLabels] : [`${algorithm.minRounds}–${algorithm.maxRounds} 轮`,"第 1 轮为本地基线"]} />],
              ]} />
            </Panel>

            <Panel title="参数" extra="新建任务时在高级配置里调整" flush>
              <div className="table-shell">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">参数</th>
                      <th scope="col">默认值</th>
                      <th scope="col" className="col-optional">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {algorithm.params.map((def) => (
                      <tr key={def.key}>
                        <th scope="row">{def.label}</th>
                        <td>{paramText(def, defaults).replace(/（默认）$/, "")}</td>
                        <td className="col-optional">{def.help}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </Collapsible>
      </div>
    </>
  );
}
