import { Fragment } from "react";
import { TASK_TYPES } from "../../domain/catalog";
import { type Dataset } from "../../domain/resources";
import type { State } from "../../state/store";
import { Tag } from "../common";
import { formatNumber } from "../format";
import { Icon } from "../icons";
import { DataDetail } from "./DataDetail";
import { ResourceTable } from "./ResourceTable";

export function DataResources({state, datasets, selectedId, onSelect}: {
  state: State;
  datasets: Dataset[];
  selectedId?: string;
  onSelect: (id?: string) => void;
}) {
  return (
    <ResourceTable label="联邦数据列表" className="table--resources" columns={[
      {label: "数据名称"}, {label: "任务类型"}, {label: "提供方"},
      {label: "样本数", className: "numeric"},
    ]} empty={!datasets.length} emptyContent="还没有数据。上传并通过校验后，可在联邦任务中使用。">
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
              <td data-label="提供方">{d.ownerName}</td>
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
