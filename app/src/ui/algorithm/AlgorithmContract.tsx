import { useQuery } from "@tanstack/react-query";
import { algorithmContract } from "../../api/algorithmContracts";
import { TASK_TYPES, type Algorithm } from "../../domain/catalog";
import { CodeBlock, Facts } from "../common";
import { Panel } from "../console";
import { AgentContract } from "./AgentContract";

/** 接入要求直接读取当前算法合同，不触发下载、验证或模型调用。 */
export function AlgorithmContract({ algorithm }: { algorithm: Algorithm }) {
  const query = useQuery({ queryKey: ["algorithm-contract", algorithm.id, algorithm.version],
    queryFn: () => algorithmContract(algorithm.id), staleTime: 60_000 });
  const requirements = algorithm.requirements;
  const models = [!requirements.agentRequired && requirements.participantModel ? "运行模型" : "",
    requirements.serverModel ? requirements.serverModelLabel : ""].filter(Boolean).join("、");
  return <Panel title="接入规范" id="algorithm-contract" className="algorithm-contract">
    <section className="algorithm-contract-section">
      <h3>所需资源</h3>
      <Facts items={[
        ["资源数量", `合计至少 ${algorithm.minParticipants} 方，每方至少 ${requirements.minSamples} 条数据`],
        ["执行方式", requirements.agentRequired ? "接入方提供 Agent 服务，平台编排与聚合" : "提供数据与 LLM 接口，由平台执行流程，无需 Agent API"],
        ...(models ? [
          ["LLM 接口", `${models}；使用已验证的 OpenAI 兼容接口`],
        ] as const : []),
      ]} />
      {query.data ? <p className="muted">{query.data.resourcesNote}</p> : null}
    </section>
    {query.isPending ? <p role="status">正在读取接入规范…</p> : query.error ? <div role="alert">
      <p className="field-error">接入规范读取失败</p>
      <button type="button" className="button button--secondary button--compact" onClick={() => void query.refetch()}>重新读取</button>
    </div> : null}
    {query.data ? <>
      {Object.entries(query.data.dataContracts).map(([type, data]) => <section className="algorithm-contract-section" key={type}>
        <h3>{TASK_TYPES[type]?.label ?? type}数据</h3>
        <Facts items={[["文件格式", "JSONL，每行一条记录"], ["记录字段", data.format], ["校验规则", data.rules]]} />
        <CodeBlock title="数据模板" code={data.template.map((item) => JSON.stringify(item)).join("\n")} wrap />
      </section>)}
      {query.data.agentProtocol ? <AgentContract contract={query.data} algorithm={algorithm} /> : null}
    </> : null}
  </Panel>;
}
