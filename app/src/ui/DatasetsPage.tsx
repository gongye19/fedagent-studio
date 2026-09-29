import { Fragment, useState, type Dispatch } from "react";
import { scenarioOf, TASK_TYPES } from "../domain/catalog";
import { PARTICIPANT_STATUS, type Dataset } from "../domain/resources";
import { showFlash } from "../state/flash";
import { hrefOf, navigate } from "../state/route";
import { participantOf, type Action, type State } from "../state/store";
import { Confirm, Facts, PageHead, Tag } from "./common";
import { Panel } from "./console";
import { formatNumber } from "./format";
import { Icon } from "./icons";

type Props = { state: State; dispatch: Dispatch<Action>; selectedId?: string };

/** 数据集的来源。 */
function sourceText(dataset: Dataset): string {
  if (dataset.source === "builtin") return dataset.origin ? `内置示例（${dataset.origin}）` : "内置示例";
  return dataset.source === "local" ? "留在参与方本地" : "上传到平台";
}

/**
 * 数据集：每份属于一个参与方，登记时选定场景和任务类型，只能用于同一场景、同一任务类型的联邦任务。
 * 能不能选入任务还要看持有方是否在线（本地参与方连上客户端之前是"等待连接"）。
 */
export default function DatasetsPage({ state, dispatch, selectedId }: Props) {
  const toggle = (id: string) => navigate(selectedId === id ? { page: "datasets" } : { page: "datasets", id }, { keepScroll: true });
  // 新登记的在前，内置示例在后。
  const datasets = [...state.datasets].sort((a, b) => Number(a.source === "builtin") - Number(b.source === "builtin"));

  return (
    <>
      <PageHead
        title="数据集"
        meta="每份数据集属于一个参与方。登记时选定场景和任务类型，只能用于同一场景、同一任务类型的联邦任务。"
        actions={<a className="button button--primary" href={hrefOf({ page: "newDataset" })}><Icon name="plus" />新增数据集</a>}
      />

      <Panel flush>
        <div className="table-shell">
          <table className="table table--rows table--fixed">
            <thead>
              <tr>
                <th scope="col" style={{ width: "24%" }}>数据集</th>
                <th scope="col" className="col-optional" style={{ width: "18%" }}>参与方</th>
                <th scope="col" style={{ width: "15%" }}>场景</th>
                <th scope="col" style={{ width: "15%" }}>任务类型</th>
                <th scope="col" className="numeric col-optional" style={{ width: "12%" }}>样本</th>
                <th scope="col" className="col-optional" style={{ width: "16%" }}>状态</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((dataset) => {
                const owner = participantOf(state, dataset.participantId);
                const open = selectedId === dataset.id;
                return (
                  <Fragment key={dataset.id}>
                    <tr
                      className={`row--toggle${open ? " row--open" : ""}`}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("button, a, input, label")) return;
                        toggle(dataset.id);
                      }}
                    >
                      <th scope="row">
                        <button type="button" className="row-button" aria-expanded={open} onClick={() => toggle(dataset.id)}>
                          <Icon name="chevron" />
                          <span className="cell-title">
                            {dataset.name}
                            {dataset.description && dataset.description !== dataset.name ? <span className="cell-note">{dataset.description}</span> : null}
                          </span>
                        </button>
                      </th>
                      <td className="col-optional">{owner ? <a className="text-link" href={hrefOf({ page: "participants", id: owner.id })}>{owner.name}</a> : "—"}</td>
                      <td>{scenarioOf(dataset.scenario).short}</td>
                      <td>{TASK_TYPES[dataset.taskType].label}</td>
                      <td className="numeric col-optional">{dataset.source === "local" ? "—" : formatNumber(dataset.count)}</td>
                      <td className="col-optional">{owner && owner.status !== "online" ? <Tag tone="warning">{PARTICIPANT_STATUS[owner.status]}</Tag> : <span className="status-text">可用</span>}</td>
                    </tr>
                    {open ? (
                      <tr className="detail-row">
                        <td colSpan={6}>
                          <DatasetDetail dataset={dataset} dispatch={dispatch} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/** 展开后：来源、标注、数据格式和一条样本示例；自己登记的数据集可以删除。 */
function DatasetDetail({ dataset, dispatch }: { dataset: Dataset; dispatch: Dispatch<Action> }) {
  const [removing, setRemoving] = useState(false);
  const type = TASK_TYPES[dataset.taskType];

  function remove() {
    dispatch({ type: "removeDataset", id: dataset.id });
    showFlash({ page: "datasets" }, `已删除数据集“${dataset.name}”。`);
    navigate({ page: "datasets" }, { keepScroll: true });
  }

  return (
    <div className="participant-detail">
      <Facts className="facts--columns" items={[
        ["来源", sourceText(dataset)],
        ["标注", dataset.source === "local"
          ? "连上客户端后上报"
          : dataset.answered === dataset.count
            ? `${formatNumber(dataset.count)} 条都有标注`
            : `${formatNumber(dataset.count)} 条中 ${formatNumber(dataset.answered)} 条有标注`],
        ["数据格式", <code key="format">{type.format}</code>],
        ["评估指标", type.metric],
      ]} />
      {dataset.sample ? (
        <div className="sample-question">
          <span>样本示例</span>
          <p lang="en">{dataset.sample.question}</p>
          {dataset.sample.answer ? <p className="sample-answer" lang="en">标注：{dataset.sample.answer}</p> : null}
        </div>
      ) : null}
      {dataset.source === "builtin" ? null : removing ? (
        <Confirm title={`删除数据集“${dataset.name}”？`} confirmLabel="删除" onConfirm={remove} onCancel={() => setRemoving(false)}>
          删除后不能再选入新任务；已有任务里的记录不受影响。
        </Confirm>
      ) : (
        <div className="detail-actions">
          <button type="button" className="button button--secondary button--compact button--danger" onClick={() => setRemoving(true)}>删除数据集</button>
        </div>
      )}
    </div>
  );
}
