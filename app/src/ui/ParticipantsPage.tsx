import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { api, ApiError } from "../api/client";
import { SCENARIOS, TASK_TYPES, type ScenarioId } from "../domain/catalog";
import { HOSTING_LABELS, PARTICIPANT_STATUS, pendingNote, type Dataset, type Participant } from "../domain/resources";
import { deleteDataset, deleteParticipant } from "../state/actions";
import { showFlash } from "../state/flash";
import { hrefOf, navigate } from "../state/route";
import { keys } from "../state/server";
import { datasetsOf, type State } from "../state/store";
import { CodeBlock, Collapsible, Confirm, Facts, Notice, PageHead, PanelEmpty, SearchInput, Tag } from "./common";
import { Panel } from "./console";
import { TaskTypeSelect, type TaskTypeFilter } from "./filters";
import { formatNumber } from "./format";
import { Icon } from "./icons";

/** selectedId：要展开的那一行（数据集 id，或参与方 id 时展开它的每一行）。 */
type Props = { state: State; selectedId?: string };

/** 表格的一行：一个参与方在这个场景下登记的一份数据集。 */
type Row = { participant: Participant; dataset: Dataset };

/**
 * 参与方与数据：和联邦任务、应用一样按场景分块（横向、纵向、迁移），每块一张表，只写参与方和数据：
 * 一行是一个参与方在这个场景下登记的一份数据集，列为参与方、数据集、任务类型、状态、样本数。
 * 任务类型是第二层分类：表格里单独一列，上方可以按任务类型筛选。参加了哪些任务属于联邦任务，不在这里显示。
 * 参与方本身不绑定场景：它在几个场景下有数据集，就出现在几块里。
 */
export default function ParticipantsPage({ state, selectedId }: Props) {
  const [taskType, setTaskType] = useState<TaskTypeFilter>("all");
  const [query, setQuery] = useState("");
  const keyword = query.trim().toLowerCase();
  // 新登记的参与方在前（登记时插到最前面），内置数据在后；同一个参与方的几份数据集排在一起。
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
        meta="管理参与方及其数据集。"
        actions={(
          <>
            <a className="button button--secondary" href={hrefOf({ page: "newDataset" })}><Icon name="plus" />新增数据集</a>
            <a className="button button--primary" href={hrefOf({ page: "newParticipant" })}><Icon name="plus" />新增参与方</a>
          </>
        )}
      />
      <div className="list-toolbar" role="search" aria-label="筛选参与方与数据">
        <SearchInput
          name="participant-search"
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
              className={!available && !rows.length ? "panel--planned" : undefined}
              title={<>{scenario.name}{available ? null : <Tag>规划中</Tag>}</>}
              extra={all.length ? `${new Set(all.map((row) => row.participant.id)).size} 个参与方，${all.length} 份数据集` : undefined}
              flush
            >
              {rows.length ? <DataTable state={state} scenario={scenario.id} rows={rows} selectedId={selectedId} /> : (
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
 * 一个场景下的全部数据集：参与方、数据集、任务类型、状态、样本数；名称和机构分行，状态独立。
 * 点开一行看运行位置、这份数据集的详情和操作；手机上每行变成一张卡片，字段名写在值上面。
 */
function DataTable({
  state, scenario, rows, selectedId,
}: {
  state: State;
  scenario: ScenarioId;
  rows: readonly Row[];
  selectedId?: string;
}) {
  return (
    <div className="table-shell">
      {/* 列宽固定（宽屏），展开详情时列不会跳动 */}
      <table className="table table--rows table--fixed table--stack table--participants">
        <thead>
          <tr>
            <th scope="col" style={{ width: "28%" }}>参与方</th>
            <th scope="col" style={{ width: "28%" }}>数据集</th>
            <th scope="col" style={{ width: "16%" }}>任务类型</th>
            <th scope="col" style={{ width: "16%" }}>状态</th>
            <th scope="col" className="numeric" style={{ width: "12%" }}>样本数</th>
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
                    <button type="button" className="row-button" aria-expanded={open} aria-label={`${open ? "收起" : "查看"}${participant.name}的${dataset.name}`} onClick={toggle}>
                      <Icon name="chevron" />
                      <span className="participant-identity">
                        <span>{participant.name}</span>
                        {participant.org ? <span className="cell-note">{participant.org}</span> : null}
                      </span>
                    </button>
                  </th>
                  <td data-label="数据集">
                    {dataset.name}
                    {dataset.description && dataset.description !== dataset.name ? <small>{dataset.description}</small> : null}
                  </td>
                  <td data-label="任务类型">{TASK_TYPES[dataset.taskType].label}</td>
                  <td data-label="状态">{participant.status === "online" ? <span className="status-text">在线</span> : <Tag tone="warning">{PARTICIPANT_STATUS[participant.status]}</Tag>}</td>
                  <td className="numeric" data-label="样本数">{dataset.ready ? formatNumber(dataset.count) : pendingNote(dataset)}</td>
                </tr>
                {open ? (
                  <tr className="detail-row">
                    <td colSpan={5}>
                      <RowDetail key={dataset.id} state={state} participant={participant} dataset={dataset} scenario={scenario} />
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
  if (dataset.source === "builtin") return dataset.origin ? `基准题库（${dataset.origin}）` : "基准题库";
  return dataset.source === "local" ? "留在参与方本地" : "上传到平台";
}

/**
 * 展开后先分区展示数据集和参与方概况，样本与本地连接步骤按需展开。
 * 自己登记的数据集可以删，但参与方至少留一份：只有一份时不能单独删，要删就删除参与方。
 */
function RowDetail({
  state, participant, dataset, scenario,
}: {
  state: State;
  participant: Participant;
  dataset: Dataset;
  scenario: ScenarioId;
}) {
  const [pending, setPending] = useState<"dataset" | "participant" | null>(null);
  const removable = dataset.source !== "builtin" && datasetsOf(state, participant.id).length > 1;

  async function remove(kind: "dataset" | "participant") {
    if (kind === "dataset") await deleteDataset(dataset.id);
    else await deleteParticipant(participant.id);
    setPending(null);
    showFlash({ page: "participants" }, kind === "dataset" ? `已删除数据集“${dataset.name}”。` : `已删除“${participant.name}”。`);
    navigate({ page: "participants", scenario }, { keepScroll: true });
  }

  return (
    <div className="participant-detail">
      <div className="participant-detail-grid">
        <section className="participant-section" aria-label="数据集信息">
          <h3>数据集信息</h3>
          <Facts items={[
            ["来源", sourceText(dataset)],
            ["已标注", dataset.ready ? `${formatNumber(dataset.answered)} / ${formatNumber(dataset.count)} 条` : dataset.source === "local" ? "待客户端上报" : "待导入"],
          ]} />
          {dataset.sample ? (
            <Collapsible title="样本预览" className="sample-preview">
              <div className="sample-question">
                {dataset.sample.fields?.length ? dataset.sample.fields.map((field) => (
                  <div key={field.label}><strong>{field.label}</strong><p>{field.text}</p></div>
                )) : <><p>{dataset.sample.question}</p>
                  {dataset.sample.answer ? <p className="sample-answer">标注：{dataset.sample.answer}</p> : null}</>}
              </div>
            </Collapsible>
          ) : null}
        </section>
        <section className="participant-section" aria-label="参与方信息">
          <h3>参与方信息</h3>
          <Facts items={[["运行位置", HOSTING_LABELS[participant.hosting]]]} />
          {participant.intro ? <p className="detail-lede">{participant.intro}</p> : null}
        </section>
      </div>
      {pending === "dataset" ? (
        <Confirm title={`删除数据集“${dataset.name}”？`} confirmLabel="删除" onConfirm={() => remove("dataset")} onCancel={() => setPending(null)}>
          删除后不能再选入新任务；已有任务里的记录不受影响。
        </Confirm>
      ) : pending === "participant" ? (
        <Confirm title={`删除“${participant.name}”？`} confirmLabel="删除" onConfirm={() => remove("participant")} onCancel={() => setPending(null)}>
          它的数据集会一起删除；已有任务里的记录不受影响。
        </Confirm>
      ) : null}
      <div className="detail-actions">
        <a className="button button--secondary button--compact" href={hrefOf({ page: "newDataset", participant: participant.id })}><Icon name="plus" />新增数据集</a>
        <div className="detail-actions-destructive">
          {removable ? <button type="button" className="button button--secondary button--compact button--danger" onClick={() => setPending("dataset")}>删除数据集</button> : null}
          {participant.builtin ? null : <button type="button" className="button button--secondary button--compact button--danger" onClick={() => setPending("participant")}>删除参与方</button>}
        </div>
      </div>
      {participant.hosting === "local" ? <LocalConnect participantId={participant.id} datasetIds={datasetsOf(state, participant.id).map((item) => item.id)} /> : null}
    </div>
  );
}

/**
 * 本地参与方的连接步骤：签发客户端令牌（只显示这一次，平台只存哈希），在参与方的环境里装好客户端和算法插件后运行。
 * 令牌和模型密钥都放进环境变量，不写在命令行里。
 */
function LocalConnect({ participantId, datasetIds }: { participantId: string; datasetIds: string[] }) {
  const [token, setToken] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const meta = useQuery({ queryKey: keys.meta, queryFn: api.meta, staleTime: 60_000 });
  const origin = window.location.origin;
  const datasets = datasetIds.map((id) => `  --dataset ${id}=./${id}.jsonl \\`).join("\n");
  // 客户端、SDK 和插件的安装包由平台提供（部署时构建），写全地址安装，不会从公共仓库装到同名的包
  const packages = meta.data?.clientPackages ?? [];
  const install = packages.length
    ? `pip install \\\n${packages.map((name) => `  ${origin}/client/${name}`).join(" \\\n")}`
    : "";

  async function issue() {
    setIssuing(true);
    setProblem(null);
    try {
      setToken((await api.issueClientToken(participantId)).token ?? null);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "签发失败，稍后再试");
    } finally {
      setIssuing(false);
    }
  }

  return (
    <Collapsible title="客户端连接" className="participant-connect">
      <div className="connect-steps">
        <p className="connect-requirement">在参与方环境执行，需要 Python 3.12 或更高版本。</p>
        {meta.isPending ? <p role="status">正在读取安装包…</p> : meta.isError ? (
          <Notice tone="warning" action={<button type="button" className="link-button" onClick={() => void meta.refetch()}>重试</button>}>无法读取客户端安装包</Notice>
        ) : install ? <CodeBlock title="1. 安装客户端" code={install} /> : <Notice tone="warning">服务器尚未发布客户端安装包</Notice>}
        <div className="connect-environment">
          <CodeBlock title="2. 设置环境变量" actions={token ? <Tag tone="warning">仅显示一次</Tag> : <button type="button" className="button button--secondary button--compact" disabled={issuing} onClick={() => void issue()}>{issuing ? "正在签发…" : "签发客户端令牌"}</button>} code={`export FEDAGENT_TOKEN="${token ?? "<客户端令牌>"}"
export MODEL_KEY="<本方模型的密钥>"`} />
          {problem ? <Notice tone="warning" onDismiss={() => setProblem(null)}>{problem}</Notice> : null}
        </div>
        <CodeBlock title="3. 运行连接" code={`fedagent-client run --server ${origin} \\
${datasets}
  --model-base-url "https://<本方模型的地址>/v1" --model "<模型名>" \\
  --api-key-env MODEL_KEY --review`} />
        <p className="connect-foot"><code>--review</code> 会在上传前逐条确认。</p>
      </div>
    </Collapsible>
  );
}
