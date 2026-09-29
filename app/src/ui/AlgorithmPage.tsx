import { defaultParams, paramText, scenarioOf, TASK_TYPES, type Algorithm } from "../domain/catalog";
import { Facts, PageHead, Tag } from "./common";
import { Panel } from "./console";

/** 算法详情：概况、每轮步骤、参数（默认值和说明）、来源。页面只读注册表，不针对某个算法写死。 */
export default function AlgorithmPage({ algorithm }: { algorithm: Algorithm }) {
  const defaults = defaultParams(algorithm);
  const sides = [
    { label: "参与方", stages: algorithm.stages.filter((stage) => stage.side === "participant") },
    { label: "服务端", stages: algorithm.stages.filter((stage) => stage.side === "server") },
  ];
  return (
    <>
      <PageHead
        crumbs={[{ label: "算法", route: { page: "algorithms" } }]}
        title={algorithm.name}
        status={<Tag>{scenarioOf(algorithm.scenario).name}</Tag>}
        meta={algorithm.summary}
      />
      <div className="panel-stack">
        <Panel title="概况">
          <Facts className="facts--columns" items={[
            ["全称", <span key="full" translate="no">{algorithm.fullName}</span>],
            ["场景", scenarioOf(algorithm.scenario).name],
            ["任务类型", algorithm.accepts.map((type) => TASK_TYPES[type].label).join("、")],
            ["通信内容", algorithm.exchange],
            ["产出", algorithm.output.name],
            ["参与方", `至少 ${algorithm.minParticipants} 个`],
            ["轮次", `${algorithm.minRounds}–${algorithm.maxRounds} 轮，第 1 轮是本地基线`],
          ]} />
        </Panel>

        <Panel title="每轮步骤" extra={`共 ${algorithm.stages.length} 步`}>
          <div className="algo-steps">
            {sides.map((side) => (
              <div key={side.label} className="algo-steps-group">
                <h3>{side.label}</h3>
                <ol>
                  {side.stages.map((stage) => (
                    <li key={stage.id}>
                      <span className="algo-step-index" aria-hidden="true">{algorithm.stages.indexOf(stage) + 1}</span>
                      <span>{stage.label}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
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

        <Panel title="来源">
          <Facts items={[
            ["论文", <a key="paper" className="text-link" href={algorithm.source.paperUrl} target="_blank" rel="noreferrer">{algorithm.source.paper}</a>],
            ["代码", <a key="code" className="text-link" href={algorithm.source.codeUrl} target="_blank" rel="noreferrer">{algorithm.source.code}</a>],
          ]} />
        </Panel>
      </div>
    </>
  );
}
