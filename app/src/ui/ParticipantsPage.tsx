import { Fragment, useState, type Dispatch } from "react";
import { SCENARIOS, TASK_TYPES, type ScenarioId } from "../domain/catalog";
import { HOSTING_LABELS, PARTICIPANT_STATUS, type Dataset, type Participant } from "../domain/resources";
import { showFlash } from "../state/flash";
import { hrefOf, navigate } from "../state/route";
import { datasetsOf, type Action, type State } from "../state/store";
import { CodeBlock, Confirm, Facts, PageHead, PanelEmpty, Tag } from "./common";
import { Panel } from "./console";
import { TaskTypeSelect, type TaskTypeFilter } from "./filters";
import { formatNumber } from "./format";
import { Icon } from "./icons";

/** selectedId：要展开的那一行（数据集 id，或参与方 id 时展开它的每一行）。 */
type Props = { state: State; dispatch: Dispatch<Action>; selectedId?: string };

/** 表格的一行：一个参与方在这个场景下登记的一份数据集。 */
type Row = { participant: Participant; dataset: Dataset };

/**
 * 参与方与数据：和联邦任务、应用一样按场景分块（横向、纵向、迁移），每块一张表，只写参与方和数据：
 * 一行是一个参与方在这个场景下登记的一份数据集，列为参与方、数据集、任务类型、样本数。
 * 任务类型是第二层分类：表格里单独一列，上方可以按任务类型筛选。参加了哪些任务属于联邦任务，不在这里显示。
 * 参与方本身不绑定场景：它在几个场景下有数据集，就出现在几块里。
 */
export default function ParticipantsPage({ state, dispatch, selectedId }: Props) {
  const [taskType, setTaskType] = useState<TaskTypeFilter>("all");
  const [query, setQuery] = useState("");
  const keyword = query.trim().toLowerCase();
  // 新登记的参与方在前（登记时插到最前面），内置示例在后；同一个参与方的几份数据集排在一起。
  const participants = [...state.participants].sort((a, b) => Number(Boolean(a.builtin)) - Number(Boolean(b.builtin)));
  const rowsOf = (scenario: ScenarioId) => participants.flatMap((participant) => datasetsOf(state, participant.id)
    .filter((dataset) => dataset.scenario === scenario)
    .map((dataset) => ({ participant, dataset })));
  const matches = ({ participant, dataset }: Row) => (taskType === "all" || dataset.taskType === taskType)
    && (!keyword || participant.name.toLowerCase().includes(keyword) || dataset.name.toLowerCase().includes(keyword));
  const filtering = taskType !== "all" || Boolean(keyword);

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
      <div className="list-toolbar">
        <input
          type="search"
          name="participant-search"
          autoComplete="off"
          aria-label="搜索参与方或数据集"
          placeholder="搜索参与方或数据集…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <TaskTypeSelect value={taskType} onChange={setTaskType} />
        {filtering ? <button type="button" className="button button--ghost button--compact" onClick={() => { setQuery(""); setTaskType("all"); }}>清除筛选</button> : null}
      </div>
      <div className="panel-stack">
        {SCENARIOS.map((scenario) => {
          const available = scenario.status === "available";
          const all = rowsOf(scenario.id);
          const rows = all.filter(matches);
          return (
            <Panel
              key={scenario.id}
              id={`participants-${scenario.id}`}
              title={<>{scenario.name}{available ? null : <Tag>规划中</Tag>}</>}
              extra={all.length ? `${new Set(all.map((row) => row.participant.id)).size} 个参与方，${all.length} 份数据集` : undefined}
              flush
            >
              {rows.length ? <DataTable state={state} dispatch={dispatch} scenario={scenario.id} rows={rows} selectedId={selectedId} /> : (
                <PanelEmpty>
                  {all.length
                    ? "没有符合条件的参与方。"
                    : available
                      ? `还没有参与方登记${scenario.short}的数据集。`
                      : `${scenario.short}的算法还在规划中，接入后可以登记这个场景的数据集。`}
                </PanelEmpty>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}

/**
 * 一个场景下的全部数据集：参与方、数据集、任务类型、样本数。还不能用的参与方（等待连接、离线）在名字旁标出来。
 * 点开一行看运行位置、这份数据集的详情和操作；手机上每行变成一张卡片，字段名写在值上面。
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
  return (
    <div className="table-shell">
      {/* 列宽固定（宽屏），展开详情时列不会跳动 */}
      <table className="table table--rows table--fixed table--stack">
        <thead>
          <tr>
            <th scope="col" style={{ width: "34%" }}>参与方</th>
            <th scope="col" style={{ width: "30%" }}>数据集</th>
            <th scope="col" style={{ width: "20%" }}>任务类型</th>
            <th scope="col" className="numeric" style={{ width: "16%" }}>样本数</th>
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
                        {participant.status === "online" ? null : <Tag tone="warning">{PARTICIPANT_STATUS[participant.status]}</Tag>}
                      </span>
                    </button>
                  </th>
                  <td data-label="数据集">
                    {dataset.name}
                    {dataset.description && dataset.description !== dataset.name ? <small>{dataset.description}</small> : null}
                  </td>
                  <td data-label="任务类型">{TASK_TYPES[dataset.taskType].label}</td>
                  <td className="numeric" data-label="样本数">{dataset.source === "local" ? "连上后上报" : formatNumber(dataset.count)}</td>
                </tr>
                {open ? (
                  <tr className="detail-row">
                    <td colSpan={4}>
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
        ["运行位置", HOSTING_LABELS[participant.hosting]],
        ["状态", PARTICIPANT_STATUS[participant.status]],
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
