import { Fragment, useState, type Dispatch } from "react";
import { SCENARIOS, TASK_TYPES, type ScenarioId } from "../domain/catalog";
import { HOSTING_LABELS, PARTICIPANT_STATUS, type Dataset, type Participant } from "../domain/resources";
import { showFlash } from "../state/flash";
import { hrefOf, navigate } from "../state/route";
import { datasetsOf, type Action, type State } from "../state/store";
import { CodeBlock, Confirm, EmptyState, Facts, PageHead, TabLinks, Tag } from "./common";
import { Panel } from "./console";
import { formatNumber } from "./format";
import { Icon } from "./icons";

type Props = { state: State; dispatch: Dispatch<Action>; scenario?: ScenarioId; selectedId?: string };

/** 表格的一行：一个参与方在这个场景下登记的一份数据集。 */
type Row = { participant: Participant; dataset: Dataset };

/**
 * 参与方与数据：按场景分标签（横向、纵向、迁移）。每个标签一张表，一行是一个参与方在这个场景下登记的一份数据集，
 * 任务类型是数据集的一列。参与方本身不绑定场景：它在几个场景下有数据集，就出现在几个标签里。
 */
export default function ParticipantsPage({ state, dispatch, scenario, selectedId }: Props) {
  // 地址里没写场景时（例如只带了参与方的链接），打开这个参与方的数据集所在的场景，否则打开第一个场景。
  const active: ScenarioId = scenario
    ?? state.datasets.find((dataset) => dataset.participantId === selectedId || dataset.id === selectedId)?.scenario
    ?? SCENARIOS[0].id;
  // 新登记的参与方在前（登记时插到最前面），内置示例在后；同一个参与方的几份数据集排在一起。
  const participants = [...state.participants].sort((a, b) => Number(Boolean(a.builtin)) - Number(Boolean(b.builtin)));
  const rows: Row[] = participants.flatMap((participant) => datasetsOf(state, participant.id)
    .filter((dataset) => dataset.scenario === active)
    .map((dataset) => ({ participant, dataset })));
  const countOf = (id: ScenarioId) => new Set(state.datasets.filter((dataset) => dataset.scenario === id).map((dataset) => dataset.participantId)).size;
  const current = SCENARIOS.find((item) => item.id === active) ?? SCENARIOS[0];

  return (
    <>
      <PageHead
        title="参与方与数据"
        meta="每一行是一个参与方在这个场景下登记的一份数据集。"
        actions={(
          <>
            <a className="button button--secondary" href={hrefOf({ page: "newDataset" })}><Icon name="plus" />新增数据集</a>
            <a className="button button--primary" href={hrefOf({ page: "newParticipant" })}><Icon name="plus" />新增参与方</a>
          </>
        )}
      />
      <TabLinks
        label="联邦场景"
        tabs={SCENARIOS.map((item) => ({
          id: item.id,
          label: <>{item.short}<span className="tab-count">{item.status === "available" || countOf(item.id) ? countOf(item.id) : "规划中"}</span></>,
        }))}
        active={active}
        routeOf={(id) => ({ page: "participants", scenario: id })}
      />
      <div className="tab-panel">
        {rows.length ? (
          <Panel flush>
            <DataTable state={state} dispatch={dispatch} scenario={active} rows={rows} selectedId={selectedId} />
          </Panel>
        ) : current.status === "available" ? (
          <EmptyState title="还没有参与方" action={<a className="button button--secondary" href={hrefOf({ page: "newParticipant" })}>新增参与方</a>}>
            <p>登记了{current.short}数据集的参与方会列在这里。</p>
          </EmptyState>
        ) : (
          <EmptyState title="还没有参与方">
            <p>{current.short}的算法还在规划中，接入后可以登记这个场景的数据集。</p>
          </EmptyState>
        )}
      </div>
    </>
  );
}

/**
 * 一个场景下的全部数据集：参与方、数据集、任务类型、样本、运行位置、状态、参加过的任务。
 * 点开一行看这份数据集的详情和操作；手机上每行变成一张卡片，字段名写在值上面。
 */
function DataTable({
  state, dispatch, scenario, rows, selectedId,
}: {
  state: State;
  dispatch: Dispatch<Action>;
  scenario: ScenarioId;
  rows: readonly Row[];
  selectedId?: string;
}) {
  const tasksOf = (dataset: Dataset) => state.tasks.filter((task) => task.members.some((member) => member.datasetId === dataset.id)).length;
  return (
    <div className="table-shell">
      {/* 列宽固定（宽屏），展开详情时列不会跳动 */}
      <table className="table table--rows table--fixed table--stack">
        <thead>
          <tr>
            <th scope="col" style={{ width: "21%" }}>参与方</th>
            <th scope="col" style={{ width: "21%" }}>数据集</th>
            <th scope="col" style={{ width: "12%" }}>任务类型</th>
            <th scope="col" className="numeric" style={{ width: "8%" }}>样本</th>
            <th scope="col" style={{ width: "13%" }}>运行位置</th>
            <th scope="col" style={{ width: "13%" }}>状态</th>
            <th scope="col" className="numeric" style={{ width: "10%" }}>参加任务</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ participant, dataset }) => {
            // 地址里可以是数据集 id，也可以是参与方 id（例如从新建任务的"查看"过来）。
            const open = selectedId === dataset.id || selectedId === participant.id;
            const toggle = () => navigate(open ? { page: "participants", scenario } : { page: "participants", scenario, id: dataset.id }, { keepScroll: true });
            return (
              <Fragment key={dataset.id}>
                <tr
                  className={`row--toggle${open ? " row--open" : ""}`}
                  onClick={(event) => {
                    // 整行都能点开；点到行里的按钮、链接时交给它们自己处理。
                    if ((event.target as HTMLElement).closest("button, a, input, label")) return;
                    toggle();
                  }}
                >
                  <th scope="row">
                    <button type="button" className="row-button" aria-expanded={open} onClick={toggle}>
                      <Icon name="chevron" />
                      <span className="cell-title">
                        {participant.name}
                        {participant.org ? <span className="cell-note">{participant.org}</span> : null}
                      </span>
                    </button>
                  </th>
                  <td data-label="数据集">
                    {dataset.name}
                    {dataset.description && dataset.description !== dataset.name ? <small>{dataset.description}</small> : null}
                  </td>
                  <td data-label="任务类型">{TASK_TYPES[dataset.taskType].label}</td>
                  <td className="numeric" data-label="样本">{dataset.source === "local" ? "—" : formatNumber(dataset.count)}</td>
                  <td data-label="运行位置">{HOSTING_LABELS[participant.hosting]}</td>
                  <td data-label="状态">{participant.status === "online" ? <span className="status-text">在线</span> : <Tag tone="warning">{PARTICIPANT_STATUS[participant.status]}</Tag>}</td>
                  <td className="numeric" data-label="参加任务">{tasksOf(dataset)}</td>
                </tr>
                {open ? (
                  <tr className="detail-row">
                    <td colSpan={7}>
                      <RowDetail state={state} participant={participant} dataset={dataset} scenario={scenario} dispatch={dispatch} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 数据集的来源。 */
function sourceText(dataset: Dataset): string {
  if (dataset.source === "builtin") return dataset.origin ? `内置示例（${dataset.origin}）` : "内置示例";
  return dataset.source === "local" ? "留在参与方本地" : "上传到平台";
}

/**
 * 展开后：这份数据集的来源、标注和样本示例，参与方的简介和本地连接步骤，以及操作。
 * 自己登记的数据集可以删，但参与方至少留一份：只有一份时不能单独删，要删就删除参与方。
 */
function RowDetail({
  state, participant, dataset, scenario, dispatch,
}: {
  state: State;
  participant: Participant;
  dataset: Dataset;
  scenario: ScenarioId;
  dispatch: Dispatch<Action>;
}) {
  const [pending, setPending] = useState<"dataset" | "participant" | null>(null);
  const removable = dataset.source !== "builtin" && datasetsOf(state, participant.id).length > 1;

  function removeDataset() {
    dispatch({ type: "removeDataset", id: dataset.id });
    showFlash({ page: "participants" }, `已删除数据集“${dataset.name}”。`);
    navigate({ page: "participants", scenario }, { keepScroll: true });
  }

  function removeParticipant() {
    dispatch({ type: "removeParticipant", id: participant.id });
    showFlash({ page: "participants" }, `已删除“${participant.name}”。`);
    navigate({ page: "participants", scenario }, { keepScroll: true });
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
      ]} />
      {dataset.sample ? (
        <div className="sample-question">
          <span>样本示例</span>
          <p lang="en">{dataset.sample.question}</p>
          {dataset.sample.answer ? <p className="sample-answer" lang="en">标注：{dataset.sample.answer}</p> : null}
        </div>
      ) : null}
      {participant.intro ? <p className="detail-lede">{participant.intro}</p> : null}
      {participant.hosting === "local" ? <LocalConnect /> : null}
      {pending === "dataset" ? (
        <Confirm title={`删除数据集“${dataset.name}”？`} confirmLabel="删除" onConfirm={removeDataset} onCancel={() => setPending(null)}>
          删除后不能再选入新任务；已有任务里的记录不受影响。
        </Confirm>
      ) : pending === "participant" ? (
        <Confirm title={`删除“${participant.name}”？`} confirmLabel="删除" onConfirm={removeParticipant} onCancel={() => setPending(null)}>
          它的数据集会一起删除；已有任务里的记录不受影响。
        </Confirm>
      ) : (
        <div className="detail-actions">
          <a className="button button--secondary button--compact" href={hrefOf({ page: "newDataset", participant: participant.id })}><Icon name="plus" />为这个参与方新增数据集</a>
          {removable ? <button type="button" className="button button--secondary button--compact button--danger" onClick={() => setPending("dataset")}>删除数据集</button> : null}
          {participant.builtin ? null : <button type="button" className="button button--secondary button--compact button--danger" onClick={() => setPending("participant")}>删除参与方</button>}
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
