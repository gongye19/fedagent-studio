import type { AlgorithmContract } from "../../api/algorithmContracts";
import type { Algorithm } from "../../domain/catalog";
import { CodeBlock, Facts } from "../common";

const FIELD_LABELS: Record<string, string> = {
  predictions: "预测结果", prediction: "预测要求", reports: "报告字段", privacy: "数据边界",
  channel: "交换通道", keptKey: "本地保存键", valueType: "值类型", valueSchema: "值结构", behavior: "处理要求",
};

export function AgentContract({ contract, algorithm }: { contract: AlgorithmContract; algorithm: Algorithm }) {
  const protocol = contract.agentProtocol;
  if (!protocol) return null;
  return <>
    <section className="algorithm-contract-section">
      <h3>Agent 服务接口</h3>
      <Facts items={[["协议", protocol.protocol], ["算法版本", algorithm.version],
        ["大小限制", `请求 ${protocol.limits.requestBytes.toLocaleString()} 字节，响应 ${protocol.limits.responseBytes.toLocaleString()} 字节；单条交换消息 ${protocol.limits.messageBytes.toLocaleString()} 字节`]]} />
      <ul className="algorithm-endpoints">
        {Object.entries(protocol.endpoints).map(([path, description]) => <li key={path}>
          <code>{path}</code><p>{description}</p>
        </li>)}
      </ul>
    </section>
    <section className="algorithm-contract-section">
      <h3>执行顺序</h3>
      <Facts items={Object.entries(contract.plans).map(([round, steps]) => [
        algorithm.evaluationLabels?.[Number(round) - 1] ?? `第 ${round} 轮`,
        steps.map((step) => algorithm.stages.find((stage) => stage.id === step)?.label ?? step).join(" → "),
      ] as const)} />
    </section>
    <section className="algorithm-contract-section">
      <h3>各步骤输出要求</h3>
      {Object.entries(contract.outputContract).map(([step, fields]) => <section className="algorithm-output" key={step}>
        <h4>{algorithm.stages.find((stage) => stage.id === step)?.label ?? step} <code>{step}</code></h4>
        <Facts items={[
          ["执行粒度", contract.manifest.steps.find((entry) => entry.id === step)?.per === "item" ? "每条数据独立执行" : "每方执行一次"],
          ...Object.entries(fields).filter(([, value]) => typeof value === "string")
            .map(([key, value]) => [FIELD_LABELS[key] ?? key, String(value)] as const),
        ]} />
        {Object.entries(fields).filter(([, value]) => typeof value === "object" && value !== null).map(([key, value]) =>
          <CodeBlock key={key} title={`${step} · ${key}`} code={JSON.stringify(value, null, 2)} wrap scrollable />)}
      </section>)}
    </section>
    <section className="algorithm-contract-section">
      <h3>接口字段约束</h3>
      <CodeBlock title="能力声明 capabilitiesSchema" code={JSON.stringify(protocol.capabilitiesSchema, null, 2)} wrap scrollable />
      <CodeBlock title="运行请求 requestSchema" code={JSON.stringify(protocol.requestSchema, null, 2)} wrap scrollable />
      <CodeBlock title="运行响应 responseSchema" code={JSON.stringify(protocol.responseSchema, null, 2)} wrap scrollable />
    </section>
  </>;
}
