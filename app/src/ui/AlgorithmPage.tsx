import { useState, type ReactNode } from "react";
import { api } from "../api/client";
import { defaultParams, paramText, scenarioOf, TASK_TYPES, type Algorithm } from "../domain/catalog";
import { Collapsible, Facts, Meta, PageHead, Tag } from "./common";
import { Panel } from "./console";
import { AlgorithmFlow } from "./algorithm/AlgorithmFlow";

/** 算法详情组合注册表信息与独立流程说明，不触发任务执行。 */
export default function AlgorithmPage({ algorithm }: { algorithm: Algorithm }) {
  const defaults = defaultParams(algorithm);
  const [downloadError, setDownloadError] = useState("");
  const download = (operation: Promise<void>) => { setDownloadError(""); void operation.catch(() => setDownloadError("下载失败，请重试")); };
  const sources: [string, ReactNode][] = [["代码", <a key="code" className="text-link" href={algorithm.source.codeUrl} title={algorithm.source.code} target="_blank" rel="noreferrer">{algorithm.name} 源码</a>]];
  if (algorithm.source.paper && algorithm.source.paperUrl) sources.unshift([
    "论文", <a key="paper" className="text-link" href={algorithm.source.paperUrl} target="_blank" rel="noreferrer">{algorithm.source.paper}</a>,
  ]);
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
        <Collapsible title="接入规范">
          <Facts items={[
            ["任务参与方", `合计至少 ${algorithm.minParticipants} 方，可组合自己与其他方共享的资源`],
            ["执行方式", algorithm.requirements.agentRequired ? "接入方提供 Agent 服务，平台编排与聚合" : "数据与 LLM，由平台执行固定流程"],
            ["数据要求", algorithm.accepts.map((type) => <button key={type} type="button" className="link-button" onClick={() => download(api.downloadTemplate(type))}>{TASK_TYPES[type].label}模板</button>)],
            ["完整规范", <button key="contract" type="button" className="link-button" onClick={() => download(api.downloadAlgorithmContract(algorithm.id))}>下载接入规范</button>],
          ]} />
          {downloadError ? <p className="field-error" role="alert">{downloadError}</p> : null}
        </Collapsible>
        <Collapsible title="参数与来源">
          <div className="panel-stack">
            <Panel title="概况">
              <Facts className="facts--columns" items={[
                ["全称", <span key="full" translate="no">{algorithm.fullName}</span>],
                ["场景", scenarioOf(algorithm.scenario).name],
                ["任务类型", algorithm.accepts.map((type) => TASK_TYPES[type].label).join("、")],
                ["通信内容", algorithm.exchange],
                ["产出", algorithm.output.name],
                ["任务来源", `合计至少 ${algorithm.minParticipants} 方`],
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

            <Panel title="来源">
              <Facts items={sources} />
            </Panel>
          </div>
        </Collapsible>
      </div>
    </>
  );
}
