import { Fragment } from "react";
import { TASK_TYPES } from "../../domain/catalog";
import { type Dataset } from "../../domain/resources";
import type { State } from "../../state/store";
import { Tag } from "../common";
import { formatNumber } from "../format";
import { Icon } from "../icons";
import { DataDetail } from "./DataDetail";
import { ResourceTable } from "./ResourceTable";

export function DataResources({state, datasets, own, selectedId, onSelect}: {
  state: State;
  datasets: Dataset[];
  own: boolean;
  selectedId?: string;
  onSelect: (id?: string) => void;
}) {
  return (
    <ResourceTable label="数据资源列表" className="table--resources" columns={[
      {label: "数据名称"}, {label: "任务类型"}, {label: "所属方"},
      {label: "样本数", className: "numeric"},
    ]} empty={!datasets.length} emptyContent={own
      ? "还没有数据。上传并通过校验后，可在任务中选择。"
      : "暂无共享数据。"}>
      {datasets.map((d) => {
        const open = selectedId === d.id;
        return (
          <Fragment key={d.id}>
            <tr className={open ? "row--open" : undefined}>
              <th scope="row">
                <button
                  type="button"
                  className="row-button"
                  aria-expanded={open}
                  onClick={() => onSelect(open ? undefined : d.id)}
                >
                  <Icon name="chevron" />
                  <span>{d.name}</span>
                </button>
              </th>
              <td data-label="任务类型">
                {TASK_TYPES[d.taskType]?.label ?? d.taskType}
              </td>
              <td data-label="所属方">
                {d.ownerName}
                {d.resourceSpace === "workspace" && d.shared ? (
                  <Tag>已共享</Tag>
                ) : null}
              </td>
              <td className="numeric" data-label="样本数">
                {d.ready ? (
                  formatNumber(d.count)
                ) : (
                  <Tag tone="warning">待连接</Tag>
                )}
              </td>
            </tr>
            {open ? (
              <tr className="detail-row">
                <td colSpan={4}>
                  <DataDetail
                    state={state}
                    dataset={d}
                    onRemoved={() => onSelect()}
                  />
                </td>
              </tr>
            ) : null}
          </Fragment>
        );
      })}
    </ResourceTable>
  );
}
