import { Fragment } from "react";
import { TASK_TYPES } from "../../domain/catalog";
import { DATA_LOCATION_LABELS, type Dataset } from "../../domain/resources";
import type { State } from "../../state/store";
import { PanelEmpty, Tag } from "../common";
import { Panel } from "../console";
import { formatNumber } from "../format";
import { Icon } from "../icons";
import { DataDetail } from "./DataDetail";

export function DataResources({
  state,
  datasets,
  own,
  filtering,
  selectedId,
  onAdd,
  onSelect,
}: {
  state: State;
  datasets: Dataset[];
  own: boolean;
  filtering: boolean;
  selectedId?: string;
  onAdd: () => void;
  onSelect: (id?: string) => void;
}) {
  return (
    <Panel title="数据" extra={`${datasets.length} 份`} flush>
      {datasets.length ? (
        <div className="table-shell">
          <table className="table table--stack table--resources">
            <thead>
              <tr>
                <th scope="col">数据名称</th>
                <th scope="col">任务类型</th>
                <th scope="col">存放位置</th>
                <th scope="col" className="numeric">
                  样本数
                </th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => {
                const p = state.participants.find((p) => p.id === d.participantId);
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
                      <td data-label="任务类型">{TASK_TYPES[d.taskType]?.label ?? d.taskType}</td>
                      <td data-label="存放位置">{p ? DATA_LOCATION_LABELS[p.hosting] : "来源已删除"}</td>
                      <td className="numeric" data-label="样本数">
                        {d.ready ? formatNumber(d.count) : <Tag tone="warning">待连接</Tag>}
                      </td>
                    </tr>
                    {open ? (
                      <tr className="detail-row">
                        <td colSpan={4}>
                          <DataDetail state={state} dataset={d} onRemoved={() => onSelect()} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <PanelEmpty>
          {filtering
            ? "没有匹配的数据。"
            : own
              ? "还没有接入数据。可以在这里添加，也可以选择算法后在任务配置中提交。"
              : "没有可用的公用数据。"}
          {own ? (
            <button type="button" className="button button--secondary" onClick={onAdd}>
              接入数据
            </button>
          ) : null}
        </PanelEmpty>
      )}
    </Panel>
  );
}
