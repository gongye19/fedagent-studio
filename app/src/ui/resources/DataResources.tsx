import { useState } from "react";
import { TASK_TYPES } from "../../domain/catalog";
import type { Dataset } from "../../domain/resources";
import { deleteDataResource } from "../../state/actions";
import { hrefOf } from "../../state/route";
import { Confirm, Tag } from "../common";
import { formatNumber } from "../format";
import { ResourceTable } from "./ResourceTable";

/** 数据目录只提供识别、选用和管理所需的信息，不展开内部格式或记录。 */
export function DataResources({ datasets }: {
  datasets: readonly Dataset[];
}) {
  const [removing, setRemoving] = useState<Dataset | null>(null);
  return <>
    <ResourceTable label="联邦数据列表" className="table--resources" columns={[
      { label: "数据名称", width: "58%" }, { label: "任务类型", width: "18%" },
      { label: "样本数", className: "numeric", width: "12%" },
      { label: "操作", className: "numeric", width: "12%" },
    ]} empty={!datasets.length} emptyContent="还没有数据。上传并通过校验后，可在联邦任务中使用。">
      {datasets.map((dataset) => <tr key={dataset.id}>
        <th scope="row">{dataset.source === "local"
          ? <a className="table-link" href={hrefOf({ page: "participants", id: dataset.id })}
            aria-label={`${dataset.name}：连接管理`}>{dataset.name}</a> : dataset.name}</th>
        <td data-label="任务类型">{TASK_TYPES[dataset.taskType]?.label ?? dataset.taskType}</td>
        <td className="numeric" data-label="样本数">
          {dataset.ready ? formatNumber(dataset.count) : <Tag tone="warning">{dataset.source === "local" ? "待连接" : "未就绪"}</Tag>}
        </td>
        <td className="numeric cell-action" data-label="操作">
          {dataset.resourceSpace === "workspace" && dataset.source !== "builtin" ? <button type="button"
            className="button button--secondary button--compact button--danger"
            aria-label={`删除数据“${dataset.name}”`} onClick={() => setRemoving(dataset)}>删除</button>
            : <span className="muted">只读</span>}
        </td>
      </tr>)}
    </ResourceTable>
    {removing ? <Confirm title={`删除“${removing.name}”？`} confirmLabel="删除"
      onCancel={() => setRemoving(null)} onConfirm={async () => {
        await deleteDataResource(removing.id);
        setRemoving(null);
      }}>
      删除后，新任务不能再选择这份数据。已有任务记录和经验包会保留。
      {removing.source === "local" ? "本地客户端连接也会保留。" : null}
    </Confirm> : null}
  </>;
}
