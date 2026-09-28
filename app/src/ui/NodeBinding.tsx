import { useState, type FormEvent, type ReactNode } from "react";
import type { Dataset, WorkspaceNode } from "../domain/project";
import { computeOf, deploymentOf, meetsSpec } from "../domain/taxonomy";
import { NEW_NODE } from "../state/store";

type Props = {
  nodes: WorkspaceNode[];
  eligibleIds: ReadonlySet<string>;
  /** 最低算力规格（id）。 */
  requiredSpec?: string;
  /** 允许按项目配置交付一个新节点。 */
  newNode?: { label: string; method: string; command?: string };
  datasets: Dataset[];
  submitLabel: string;
  onSubmit: (node: string, datasetId: string) => void;
  secondary?: ReactNode;
};

const STATUS = { online: "在线", offline: "离线", provisioning: "交付中" } as const;

/** 为项目选择本机构的节点和数据：节点需在线且满足最低算力，也可以按配置交付新节点。 */
export default function NodeBinding({ nodes, eligibleIds, requiredSpec, newNode, datasets, submitLabel, onSubmit, secondary }: Props) {
  const requirement = computeOf(requiredSpec)?.label;
  const firstEligible = nodes.find((node) => eligibleIds.has(node.id))?.id ?? (newNode ? NEW_NODE : "");
  const [node, setNode] = useState(firstEligible);
  const [dataset, setDataset] = useState(datasets[0]?.id ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (node && dataset) onSubmit(node, dataset);
  }

  return (
    <form className="binding" onSubmit={submit}>
      <fieldset>
        <legend>节点{requirement ? <small>需要 ≥ {requirement}</small> : null}</legend>
        <div className="choice-list">
          {nodes.map((item) => {
            const eligible = eligibleIds.has(item.id);
            const spec = computeOf(item.spec);
            const tag = item.status !== "online"
              ? STATUS[item.status]
              : !meetsSpec(item.spec, requiredSpec)
                ? `低于 ${requirement ?? "要求"}`
                : !eligible
                  ? "已加入本项目"
                  : null;
            return (
              <label className={`choice-row${node === item.id ? " choice-row--checked" : ""}${eligible ? "" : " choice-row--disabled"}`} key={item.id} title={spec?.hint}>
                <input type="radio" name="node" value={item.id} checked={node === item.id} disabled={!eligible} onChange={() => setNode(item.id)} />
                <span className="choice-copy">
                  <strong>{item.name}</strong>
                  <small>{deploymentOf(item.location)?.label} · {spec?.label}</small>
                </span>
                {tag ? <span className="badge">{tag}</span> : null}
              </label>
            );
          })}
          {newNode ? (
            <label className={`choice-row${node === NEW_NODE ? " choice-row--checked" : ""}`}>
              <input type="radio" name="node" value={NEW_NODE} checked={node === NEW_NODE} onChange={() => setNode(NEW_NODE)} />
              <span className="choice-copy">
                <strong>交付新节点：{newNode.label}</strong>
                <small>{newNode.method}</small>
              </span>
            </label>
          ) : null}
        </div>
        {node === NEW_NODE && newNode?.command ? <pre className="command" translate="no"><code>{newNode.command}</code></pre> : null}
      </fieldset>

      <fieldset>
        <legend>数据<small>只授权本项目使用，数据不离开节点</small></legend>
        {datasets.length ? (
          <div className="choice-list">
            {datasets.map((item) => (
              <label className={`choice-row${dataset === item.id ? " choice-row--checked" : ""}`} key={item.id}>
                <input type="radio" name="dataset" value={item.id} checked={dataset === item.id} onChange={() => setDataset(item.id)} />
                <span className="choice-copy">
                  <strong>{item.name}</strong>
                  <small>{item.detail}</small>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="panel-empty">本机构还没有登记这类数据。</p>
        )}
      </fieldset>

      <div className="binding-actions">
        {secondary}
        <button type="submit" className="button button--primary" disabled={!node || !dataset}>{submitLabel}</button>
      </div>
    </form>
  );
}
