import { Fragment, useState, type Dispatch } from "react";
import { TASK_TYPES, type TaskType } from "../domain/catalog";
import { HOSTING_LABELS, PARTICIPANT_STATUS, type Dataset, type Participant } from "../domain/resources";
import { showFlash } from "../state/flash";
import { hrefOf, navigate } from "../state/route";
import { datasetsOf, taskCountOf, type Action, type State } from "../state/store";
import { CodeBlock, Confirm, Facts, FormActions, PageHead, Tag } from "./common";
import { Panel } from "./console";
import { DatasetPicker } from "./DatasetPicker";
import { formatNumber } from "./format";
import { Icon } from "./icons";

type Props = { state: State; dispatch: Dispatch<Action>; selectedId?: string };

/** 数据集的名称和说明：说明里已经包含名称时只写说明，避免"WLPMC · WLPMC 竞赛题"。 */
function datasetTitle(dataset: Dataset): string {
  if (!dataset.description) return dataset.name;
  return dataset.description.includes(dataset.name) ? dataset.description : `${dataset.name} · ${dataset.description}`;
}

/** 参与方与数据：每个参与方持有自己的数据集，由一个 Agent 代表它参加联邦任务。 */
export default function ParticipantsPage({ state, dispatch, selectedId }: Props) {
  const toggle = (id: string) => navigate(selectedId === id ? { page: "participants" } : { page: "participants", id }, { keepScroll: true });
  // 新登记的在前（登记时插到最前面），内置示例在后。
  const participants = [...state.participants].sort((a, b) => Number(Boolean(a.builtin)) - Number(Boolean(b.builtin)));

  return (
    <>
      <PageHead
        title="参与方与数据"
        meta="每个参与方持有自己的数据集，由一个 Agent 代表它参加联邦任务。"
        actions={<a className="button button--primary" href={hrefOf({ page: "newParticipant" })}><Icon name="plus" />新增参与方</a>}
      />

      <Panel flush>
        <div className="table-shell">
          {/* 列宽固定（宽屏），展开详情或新增一行时列不会跳动 */}
          <table className="table table--rows table--fixed">
            <thead>
              <tr>
                {/* 列宽按最窄的平板宽度（721px）算过："参与方本地""等待连接"都能一行放下 */}
                <th scope="col" style={{ width: "24%" }}>参与方</th>
                <th scope="col" className="col-optional" style={{ width: "27%" }}>数据集</th>
                <th scope="col" className="numeric" style={{ width: "9%" }}>样本</th>
                <th scope="col" className="col-optional" style={{ width: "15%" }}>运行位置</th>
                <th scope="col" style={{ width: "14%" }}>状态</th>
                <th scope="col" className="numeric col-optional" style={{ width: "11%" }}>参加任务</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((participant) => {
                const datasets = datasetsOf(state, participant.id);
                const reported = datasets.filter((dataset) => dataset.source !== "local");
                const open = selectedId === participant.id;
                return (
                  <Fragment key={participant.id}>
                    <tr
                      className={`row--toggle${open ? " row--open" : ""}`}
                      onClick={(event) => {
                        // 整行都能点开；点到行里的按钮时交给按钮自己处理。
                        if ((event.target as HTMLElement).closest("button, a, input, label")) return;
                        toggle(participant.id);
                      }}
                    >
                      <th scope="row">
                        <button type="button" className="row-button" aria-expanded={open} onClick={() => toggle(participant.id)}>
                          <Icon name="chevron" />
                          <span className="cell-title">
                            {participant.name}
                            {participant.org && !participant.builtin ? <span className="cell-note">{participant.org}</span> : null}
                          </span>
                        </button>
                      </th>
                      <td className="col-optional">{datasets.length ? datasets.map((dataset) => dataset.description || dataset.name).join("、") : "—"}</td>
                      <td className="numeric">{reported.length ? formatNumber(reported.reduce((sum, dataset) => sum + dataset.count, 0)) : "—"}</td>
                      <td className="col-optional">{HOSTING_LABELS[participant.hosting]}</td>
                      <td>{participant.status === "online" ? <span className="status-text">在线</span> : <Tag tone="warning">{PARTICIPANT_STATUS[participant.status]}</Tag>}</td>
                      <td className="numeric col-optional">{taskCountOf(state, participant.id)}</td>
                    </tr>
                    {open ? (
                      <tr className="detail-row">
                        <td colSpan={6}>
                          <ParticipantDetail participant={participant} datasets={datasets} dispatch={dispatch} />
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

function ParticipantDetail({ participant, datasets, dispatch }: { participant: Participant; datasets: Dataset[]; dispatch: Dispatch<Action> }) {
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);

  function remove() {
    dispatch({ type: "removeParticipant", id: participant.id });
    showFlash({ page: "participants" }, `已删除“${participant.name}”。`);
    navigate({ page: "participants" }, { keepScroll: true });
  }

  return (
    <div className="participant-detail">
      {participant.intro && !participant.builtin ? <p className="detail-lede">{participant.intro}</p> : null}
      {participant.hosting === "local" ? <LocalConnect /> : null}
      {datasets.map((dataset) => (
        <div key={dataset.id} className="dataset-info">
          <Facts className="facts--columns" items={[
            ["数据集", datasetTitle(dataset)],
            ["任务类型", TASK_TYPES[dataset.taskType].label],
            ["样本", dataset.source === "local"
              ? "连上客户端后上报"
              : dataset.answered === dataset.count
                ? `${formatNumber(dataset.count)} 条，都有标注`
                : `${formatNumber(dataset.count)} 条，其中 ${formatNumber(dataset.answered)} 条有标注`],
            ["来源", dataset.source === "builtin" ? dataset.origin ?? "内置示例" : dataset.source === "local" ? "留在参与方本地" : "上传"],
          ]} />
          {dataset.sample ? (
            <div className="sample-question">
              <span>样本示例</span>
              <p lang="en">{dataset.sample.question}</p>
              {dataset.sample.answer ? <p className="sample-answer" lang="en">标注：{dataset.sample.answer}</p> : null}
            </div>
          ) : null}
        </div>
      ))}
      {participant.hosting === "platform" && !participant.builtin && uploading ? (
        <DatasetForm
          participantId={participant.id}
          onCancel={() => setUploading(false)}
          onSave={(dataset) => {
            dispatch({ type: "addDataset", dataset });
            setUploading(false);
            showFlash({ page: "participants" }, `已为“${participant.name}”添加数据集“${dataset.name}”。`);
          }}
        />
      ) : null}
      {participant.builtin ? null : removing ? (
        <Confirm title={`删除“${participant.name}”？`} confirmLabel="删除" onConfirm={remove} onCancel={() => setRemoving(false)}>
          它的数据集会一起删除；已有任务里的记录不受影响。
        </Confirm>
      ) : (
        <div className="detail-actions">
          {participant.hosting === "platform" && !uploading ? (
            <button type="button" className="button button--secondary button--compact" onClick={() => setUploading(true)}><Icon name="upload" />上传数据集</button>
          ) : null}
          <button type="button" className="button button--secondary button--compact button--danger" onClick={() => setRemoving(true)}>删除参与方</button>
        </div>
      )}
    </div>
  );
}

/** 本地参与方的连接步骤。客户端还没发布，令牌接入后端后才签发，所以命令只展示、不提供复制。 */
function LocalConnect() {
  return (
    <div className="connect-steps">
      <h2 className="detail-title">在参与方的环境里连接</h2>
      <CodeBlock copyable={false} code={`pip install fedagent-client
fedagent-client connect \\
  --server https://<平台地址> \\
  --token <接入后端后签发> \\
  --data ./dataset.jsonl \\
  --review`} />
      <p className="connect-foot"><Tag>客户端尚未发布</Tag>连上之前不能加入任务；加 <code>--review</code> 可以在上传前逐条确认。</p>
    </div>
  );
}

function DatasetForm({ participantId, onSave, onCancel }: { participantId: string; onSave: (dataset: Dataset) => void; onCancel: () => void }) {
  const [taskType, setTaskType] = useState<TaskType | null>(null);
  const [dataset, setDataset] = useState<Omit<Dataset, "participantId"> | null>(null);
  return (
    <div className="form-body dataset-form">
      <h2 className="detail-title">上传数据集</h2>
      <DatasetPicker taskType={taskType} onTaskType={setTaskType} onChange={setDataset} />
      <FormActions
        compact
        missing={!taskType ? ["任务类型"] : dataset ? [] : ["检查通过的数据集文件"]}
        saveLabel="保存数据集"
        onCancel={onCancel}
        onSave={() => dataset && onSave({ ...dataset, participantId })}
      />
    </div>
  );
}
