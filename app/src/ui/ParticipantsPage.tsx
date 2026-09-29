import { Fragment, useState, type Dispatch } from "react";
import { HOSTING_LABELS, PARTICIPANT_STATUS, type Participant } from "../domain/resources";
import { showFlash } from "../state/flash";
import { hrefOf, navigate } from "../state/route";
import { datasetsOf, taskCountOf, type Action, type State } from "../state/store";
import { CodeBlock, Confirm, PageHead, Tag } from "./common";
import { Panel } from "./console";
import { Icon } from "./icons";
import { usageText } from "./labels";

type Props = { state: State; dispatch: Dispatch<Action>; selectedId?: string };

/**
 * 参与方：参加联邦的机构或节点。参与方本身不绑定场景，能参加哪些联邦任务由它登记的数据集决定，
 * 所以列表里写出它的数据集各用于哪个场景、哪种任务类型；数据集的详情在"数据集"页。
 */
export default function ParticipantsPage({ state, dispatch, selectedId }: Props) {
  const toggle = (id: string) => navigate(selectedId === id ? { page: "participants" } : { page: "participants", id }, { keepScroll: true });
  // 新登记的在前（登记时插到最前面），内置示例在后。
  const participants = [...state.participants].sort((a, b) => Number(Boolean(a.builtin)) - Number(Boolean(b.builtin)));

  return (
    <>
      <PageHead
        title="参与方"
        meta="参加联邦的机构或节点，原始数据不出本方。能参加哪些联邦任务，由它登记的数据集决定。"
        actions={<a className="button button--primary" href={hrefOf({ page: "newParticipant" })}><Icon name="plus" />新增参与方</a>}
      />

      <Panel flush>
        <div className="table-shell">
          {/* 列宽固定（宽屏），展开详情时列不会跳动 */}
          <table className="table table--rows table--fixed">
            <thead>
              <tr>
                <th scope="col" style={{ width: "22%" }}>参与方</th>
                <th scope="col" className="col-optional" style={{ width: "20%" }}>数据集</th>
                <th scope="col" style={{ width: "22%" }}>场景 · 任务类型</th>
                <th scope="col" className="col-optional" style={{ width: "14%" }}>运行位置</th>
                <th scope="col" style={{ width: "12%" }}>状态</th>
                <th scope="col" className="numeric col-optional" style={{ width: "10%" }}>参加任务</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((participant) => {
                const datasets = datasetsOf(state, participant.id);
                const usages = [...new Set(datasets.map((dataset) => usageText(dataset.scenario, dataset.taskType)))];
                const open = selectedId === participant.id;
                return (
                  <Fragment key={participant.id}>
                    <tr
                      className={`row--toggle${open ? " row--open" : ""}`}
                      onClick={(event) => {
                        // 整行都能点开；点到行里的按钮、链接时交给它们自己处理。
                        if ((event.target as HTMLElement).closest("button, a, input, label")) return;
                        toggle(participant.id);
                      }}
                    >
                      <th scope="row">
                        <button type="button" className="row-button" aria-expanded={open} onClick={() => toggle(participant.id)}>
                          <Icon name="chevron" />
                          <span className="cell-title">
                            {participant.name}
                            {participant.org ? <span className="cell-note">{participant.org}</span> : null}
                          </span>
                        </button>
                      </th>
                      <td className="col-optional">
                        {datasets.length ? (
                          <span className="cell-links">
                            {datasets.map((dataset) => <a key={dataset.id} className="text-link" href={hrefOf({ page: "datasets", id: dataset.id })}>{dataset.name}</a>)}
                          </span>
                        ) : "—"}
                      </td>
                      <td>{usages.length ? usages.map((usage) => <span key={usage} className="cell-line">{usage}</span>) : "—"}</td>
                      <td className="col-optional">{HOSTING_LABELS[participant.hosting]}</td>
                      <td>{participant.status === "online" ? <span className="status-text">在线</span> : <Tag tone="warning">{PARTICIPANT_STATUS[participant.status]}</Tag>}</td>
                      <td className="numeric col-optional">{taskCountOf(state, participant.id)}</td>
                    </tr>
                    {open ? (
                      <tr className="detail-row">
                        <td colSpan={6}>
                          <ParticipantDetail participant={participant} dispatch={dispatch} />
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

/** 展开后：简介、本地参与方的连接步骤，以及添加数据集、删除参与方。 */
function ParticipantDetail({ participant, dispatch }: { participant: Participant; dispatch: Dispatch<Action> }) {
  const [removing, setRemoving] = useState(false);

  function remove() {
    dispatch({ type: "removeParticipant", id: participant.id });
    showFlash({ page: "participants" }, `已删除“${participant.name}”。`);
    navigate({ page: "participants" }, { keepScroll: true });
  }

  return (
    <div className="participant-detail">
      {participant.intro ? <p className="detail-lede">{participant.intro}</p> : null}
      {participant.hosting === "local" ? <LocalConnect /> : null}
      {removing ? (
        <Confirm title={`删除“${participant.name}”？`} confirmLabel="删除" onConfirm={remove} onCancel={() => setRemoving(false)}>
          它的数据集会一起删除；已有任务里的记录不受影响。
        </Confirm>
      ) : (
        <div className="detail-actions">
          <a className="button button--secondary button--compact" href={hrefOf({ page: "newDataset", participant: participant.id })}><Icon name="plus" />添加数据集</a>
          {participant.builtin ? null : <button type="button" className="button button--secondary button--compact button--danger" onClick={() => setRemoving(true)}>删除参与方</button>}
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
