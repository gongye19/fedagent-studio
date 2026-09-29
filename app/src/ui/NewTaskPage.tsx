import { useEffect, useId, useRef, useState, type Dispatch, type MouseEvent } from "react";
import {
  algorithmOf,
  algorithmsFor,
  paramValue,
  SCENARIOS,
  scenarioOf,
  TASK_TYPES,
  taskTypesFor,
  type Algorithm,
  type ParamDef,
  type ParamValue,
  type Params,
  type ScenarioId,
  type TaskType,
} from "../domain/catalog";
import {
  activeOverrides,
  compatibleDatasets,
  DEFAULT_DRAFT,
  defaultTaskName,
  draftIssues,
  estimate,
  joinable,
  toConfig,
  type Draft,
  type Estimate,
  type RunMode,
} from "../domain/config";
import {
  DEFAULT_ENDPOINT_ID,
  DEFAULT_MODEL,
  endpointOf,
  HOSTING_LABELS,
  isConfigured,
  modelLabel,
  modelOptions,
  PARTICIPANT_STATUS,
  type Dataset,
  type Participant,
} from "../domain/resources";
import { flashFor, showFlash } from "../state/flash";
import { newId } from "../state/ids";
import { hrefOf, navigate, type Route } from "../state/route";
import { datasetsOf, participantOf, type Action, type State } from "../state/store";
import { Collapsible, Confirm, Meta, Notice, PageHead, PanelEmpty, Tag } from "./common";
import { Choices, Field, FieldGroup, Panel, UnitInput } from "./console";
import { formatDuration, formatNumber, formatTokens, formatYuan } from "./format";
import { Icon } from "./icons";
import { usageText } from "./labels";

type Props = { state: State; dispatch: Dispatch<Action>; scenario?: ScenarioId };

/** 从新建任务出发去新增参与方、数据集，配置接口，保存后回到这里。 */
const NEW_PARTICIPANT: Route = { page: "newParticipant", from: "newTask" };
const NEW_DATASET: Route = { page: "newDataset", from: "newTask" };
const endpointRoute = (id: string): Route => ({ page: "editEndpoint", id, from: "newTask" });

type Restored = { kind: "copy"; source: string } | { kind: "draft" } | null;
type Pending = "full" | "leave" | "restart" | null;

/**
 * 新建联邦任务：按云平台"创建实例"的方式，分区块配置，右侧是配置摘要和预估。
 * 场景、任务类型、算法、参数都来自注册表，页面不针对某个算法写死；每一步都由用户自己选，不替用户默认。
 * 从首页点某个场景进来时，场景已经选好：页面只列这个场景的选项，不再显示场景这一项，标题旁写明场景。
 */
export default function NewTaskPage({ state, dispatch, scenario }: Props) {
  const draft = state.draft;
  const fixedScenario = scenario && scenarioOf(scenario).status === "available" ? scenario : undefined;
  const back: Route = fixedScenario ? { page: "home" } : { page: "tasks" };
  const applied = useRef<ScenarioId | undefined>(undefined);
  // 没动过的草稿不保留：每次打开都按当前的参与方和数据重新选，默认名称也按这次打开的时间生成。
  const resetOnOpen = useRef(!draft.touched);
  const [openedAt] = useState(() => new Date());
  const [pending, setPending] = useState<Pending>(null);
  const issuesId = useId();
  // 打开时草稿里已经有用户的内容：要么是上次没填完，要么是从任务"复制为新任务"带过来的。
  // 从新增参与方、配置接口回来时顶部已经有结果提示，不再重复提示"已恢复"。
  const [restored, setRestored] = useState<Restored>(() => {
    if (!draft.touched || flashFor({ page: "newTask" })) return null;
    return draft.name?.endsWith("（副本）") ? { kind: "copy", source: draft.name.slice(0, -"（副本）".length) } : { kind: "draft" };
  });

  useEffect(() => {
    if (!resetOnOpen.current) return;
    resetOnOpen.current = false;
    dispatch({ type: "resetDraft" });
  }, [dispatch]);

  useEffect(() => {
    // 从首页的场景入口进来时预先选好；规划中的场景不能选，直接忽略。
    if (!scenario || applied.current === scenario) return;
    applied.current = scenario;
    if (scenarioOf(scenario).status === "available") dispatch({ type: "chooseScenario", scenario, auto: true });
  }, [scenario, dispatch]);

  const update = (patch: Partial<Draft>) => dispatch({ type: "updateDraft", patch });
  const algorithm = draft.algorithm ? algorithmOf(draft.algorithm) : null;
  // 能参加的参与方：名下有登记在这个场景、这种任务类型下的数据集。
  const scenarioId = draft.scenario;
  const taskType = draft.taskType;
  const candidates: Candidate[] = algorithm && scenarioId && taskType
    ? state.participants.flatMap((participant) => {
      const datasets = compatibleDatasets(scenarioId, taskType, datasetsOf(state, participant.id));
      return datasets.length ? [{ participant, datasets }] : [];
    })
    : [];
  const joined = joinable(draft, state.datasets, state.participants);
  const issues = draftIssues(draft, state.datasets, state.participants, state.endpoints);
  const config = toConfig({ ...draft, participants: joined });
  const result = config && joined.length ? estimate(config, state.datasets, state.endpoints) : null;
  const full = draft.mode === "full";
  const autoName = defaultTaskName(draft, openedAt);
  const overrideCount = Object.keys(activeOverrides(draft)).length;
  const priceEndpoint = endpointOf(draft.clientModel, state.endpoints)?.id ?? DEFAULT_ENDPOINT_ID;

  function create() {
    if (issues.length) return;
    const id = newId("task");
    const name = draft.name?.trim() || autoName;
    dispatch({ type: "createTask", id, createdAt: new Date().toISOString(), name: autoName });
    showFlash({ page: "task", id }, full ? `已创建“${name}”，开始正式运行。` : `已创建“${name}”，开始试跑。`);
    navigate({ page: "task", id, tab: "progress" });
  }

  function restart() {
    dispatch({ type: "resetDraft" });
    setPending(null);
    setRestored(null);
    if (scenario && scenarioOf(scenario).status === "available") dispatch({ type: "chooseScenario", scenario, auto: true });
  }

  function leave() {
    dispatch({ type: "resetDraft" });
    navigate(back);
  }

  /** 正式运行调用量大，先确认一次；试跑直接开始。 */
  function start() {
    if (issues.length) return;
    if (full) setPending("full");
    else create();
  }

  /** 动过的草稿要确认才放弃；没动过的直接离开。 */
  function cancel() {
    if (draft.touched) setPending("leave");
    else navigate(back);
  }

  const startLabel = full ? "创建并正式运行" : "创建并试跑";
  const cost = result ? (result.cost === null ? "费用无法估算（没有设置单价）" : `费用${formatYuan(result.cost)}`) : "";
  // 确认条里的数字按段排版（Meta），不会把"3 轮"拆成两行。
  const confirm = pending === "full" && result && !issues.length
    ? {
      title: "开始正式运行？",
      text: (
        <>
          <Meta parts={[`${joined.length} 个参与方`, `${formatNumber(result.problems)} 条样本`, `${draft.rounds} 轮`]} />
          <Meta parts={[formatDuration(result.seconds), cost]} />
          <span>创建后配置不能修改，运行中可以暂停或取消。</span>
        </>
      ),
      short: <Meta parts={[`${formatNumber(result.participantCalls)} 次调用`, formatDuration(result.seconds), result.cost === null ? "费用无法估算" : formatYuan(result.cost)]} />,
      confirmLabel: "确认开始",
      cancelLabel: "取消",
      tone: "primary" as const,
      onConfirm: create,
    }
    : pending === "leave"
      ? {
        title: "放弃这次的配置？",
        text: "已选的参与方和设置都会清空。",
        short: "已选的参与方和设置都会清空",
        confirmLabel: "放弃",
        cancelLabel: "继续编辑",
        tone: "danger" as const,
        onConfirm: leave,
      }
      : null;

  return (
    <>
      <PageHead
        title="新建联邦任务"
        crumbs={[{ label: fixedScenario ? "首页" : "联邦任务", route: back }]}
        status={fixedScenario ? <Tag>{scenarioOf(fixedScenario).name}</Tag> : undefined}
      />
      {pending === "restart" ? (
        <Confirm title="清空这次的配置？" confirmLabel="清空" onConfirm={restart} onCancel={() => setPending(null)}>
          已选的参与方和设置都会恢复默认。
        </Confirm>
      ) : restored && draft.scenario ? (
        <Notice action={<button type="button" className="link-button" onClick={() => setPending("restart")}>清空重填</button>}>
          {restored.kind === "copy" ? `已带入“${restored.source}”的配置。` : "已恢复上次没填完的配置。"}
        </Notice>
      ) : null}

      <div className="order-layout">
        <div className="order-main">
          <Panel title="基本信息" id="basic">
            <div className="form-body">
              <FieldGroup>
                <Field label="任务名称" htmlFor="task-name">
                  <input id="task-name" name="task-name" autoComplete="off" value={draft.name ?? autoName} placeholder={autoName} maxLength={60} onChange={(event) => update({ name: event.target.value })} />
                </Field>
              </FieldGroup>
            </div>
          </Panel>

          <Panel title={fixedScenario ? "任务类型与算法" : "场景、任务类型与算法"} id="scenario">
            <div className="form-body">
              <FieldGroup>
                {fixedScenario ? null : (
                  <Field label="场景" labelId="scenario-label" wide>
                    <Choices
                      labelledBy="scenario-label"
                      value={draft.scenario}
                      options={SCENARIOS.map((item) => ({ value: item.id, label: item.short, disabled: item.status !== "available", badge: item.status === "available" ? undefined : "规划中" }))}
                      onChange={(value) => dispatch({ type: "chooseScenario", scenario: value })}
                    />
                  </Field>
                )}
                {draft.scenario ? <TaskTypeChoice scenario={draft.scenario} value={draft.taskType} onChange={(taskType) => dispatch({ type: "chooseTaskType", taskType })} /> : null}
                {draft.scenario && draft.taskType ? (
                  <AlgorithmField scenario={draft.scenario} taskType={draft.taskType} value={draft.algorithm} onChange={(id) => dispatch({ type: "chooseAlgorithm", algorithm: id })} />
                ) : null}
              </FieldGroup>
            </div>
          </Panel>

          {algorithm && scenarioId && taskType ? (
            <Panel
              title="参与方"
              id="participants"
              extra={`已选 ${joined.length} 个`}
              actions={(
                <>
                  <a className="button button--secondary button--compact" href={hrefOf(NEW_DATASET)}><Icon name="plus" />新增数据集</a>
                  <a className="button button--secondary button--compact" href={hrefOf(NEW_PARTICIPANT)}><Icon name="plus" />新增参与方</a>
                </>
              )}
              flush
            >
              {candidates.length ? (
                <ParticipantTable draft={draft} dispatch={dispatch} candidates={candidates} />
              ) : (
                <PanelEmpty>还没有参与方登记了“{usageText(scenarioId, taskType)}”的数据集。</PanelEmpty>
              )}
            </Panel>
          ) : null}

          {algorithm ? (
            <Panel title="运行配置" id="settings">
              <RunSettings state={state} draft={draft} update={update} algorithm={algorithm} />
            </Panel>
          ) : null}

          {algorithm ? <AdvancedPanel state={state} draft={draft} update={update} algorithm={algorithm} joined={joined.map((item) => item.participantId)} /> : null}
        </div>

        <aside className="order-summary" aria-label="配置摘要" id="task-summary">
          <Panel title="配置摘要" className="summary-panel">
            <dl className="summary-list">
              <div><dt>场景</dt><dd>{draft.scenario ? scenarioOf(draft.scenario).short : "—"}</dd></div>
              <div><dt>任务类型</dt><dd>{draft.taskType ? TASK_TYPES[draft.taskType].label : "—"}</dd></div>
              <div><dt>算法</dt><dd>{algorithm ? algorithm.name : "—"}</dd></div>
              <div><dt>参与方</dt><dd>{joined.length ? `${joined.length} 个` : "—"}</dd></div>
              {algorithm ? (
                <>
                  <div><dt>样本</dt><dd>{result ? `${formatNumber(result.problems)} 条${full ? "" : `（每份前 ${draft.trialCap} 条）`}` : "—"}</dd></div>
                  <div><dt>运行</dt><dd>{full ? "正式运行" : "试跑"} · {draft.rounds} 轮</dd></div>
                  <div><dt>模型</dt><dd>{modelSummary(draft, state, algorithm)}</dd></div>
                  {overrideCount ? <div><dt>单独指定</dt><dd>{overrideCount} 个参与方</dd></div> : null}
                </>
              ) : null}
            </dl>
            {result ? <EstimateBlock result={result} priceHref={hrefOf(endpointRoute(priceEndpoint))} /> : null}
            {confirm ? (
              <Confirm className="summary-confirm" title={confirm.title} confirmLabel={confirm.confirmLabel} cancelLabel={confirm.cancelLabel} tone={confirm.tone} onConfirm={confirm.onConfirm} onCancel={() => setPending(null)}>
                {confirm.text}
              </Confirm>
            ) : (
              <div className="summary-actions">
                <button type="button" className="button button--primary button--block summary-start" disabled={issues.length > 0} aria-describedby={issues.length ? issuesId : undefined} onClick={start}>{startLabel}</button>
                <button type="button" className="button button--ghost button--block" onClick={cancel}>取消</button>
              </div>
            )}
            <p className="summary-issues" id={issuesId} aria-live="polite">{issues.length ? `还需要：${issues.map((issue) => issue.message).join("；")}` : ""}</p>
          </Panel>
        </aside>
      </div>

      {confirm ? (
        <Confirm className="order-bar order-bar--confirm" title={confirm.title} confirmLabel={confirm.confirmLabel} cancelLabel={confirm.cancelLabel} tone={confirm.tone} onConfirm={confirm.onConfirm} onCancel={() => setPending(null)}>
          {confirm.short}
        </Confirm>
      ) : (
        <div className="order-bar" aria-label="创建任务">
          <div>
            <strong className={issues.length ? "order-bar-issue" : undefined}>{issues.length ? `还需要：${issues[0].message}` : `${joined.length} 个参与方 · 约 ${formatNumber(result?.participantCalls ?? 0)} 次调用`}</strong>
            {result && !issues.length ? <small>{formatDuration(result.seconds)}</small> : null}
          </div>
          <div className="order-bar-actions">
            <button type="button" className="button button--ghost order-bar-cancel" onClick={cancel}>取消</button>
            <button type="button" className="button button--primary" disabled={issues.length > 0} onClick={start}>{startLabel}</button>
          </div>
        </div>
      )}
    </>
  );
}

/** 任务类型：列出这个场景里有算法能处理的类型，由用户选；指标跟着任务类型走。 */
function TaskTypeChoice({ scenario, value, onChange }: { scenario: ScenarioId; value: TaskType | null; onChange: (type: TaskType) => void }) {
  const types = taskTypesFor(scenario);
  return (
    <Field label="任务类型" labelId="task-type-label" wide>
      {types.length ? (
        <Choices labelledBy="task-type-label" value={value} options={types.map((type) => ({ value: type, label: TASK_TYPES[type].label }))} onChange={onChange} />
      ) : <p className="field-static">这个场景还没有可用的任务类型。</p>}
    </Field>
  );
}

/** 算法：带单选的表格，列出这个场景里能处理所选任务类型的算法，比较说明、交换内容和产出，由用户选。 */
function AlgorithmField({ scenario, taskType, value, onChange }: { scenario: ScenarioId; taskType: TaskType; value: Draft["algorithm"]; onChange: (id: Algorithm["id"]) => void }) {
  const algorithms = algorithmsFor(scenario, taskType);
  return (
    <Field label="算法" labelId="algorithm-label" wide>
      {algorithms.length ? <AlgorithmTable algorithms={algorithms} value={value} onChange={onChange} /> : <p className="field-static">这种任务类型在这个场景下还没有算法。</p>}
    </Field>
  );
}

function AlgorithmTable({ algorithms, value, onChange }: { algorithms: readonly Algorithm[]; value: Draft["algorithm"]; onChange: (id: Algorithm["id"]) => void }) {
  return (
    <div className="table-shell">
      <table className="table table--select">
        <caption className="visually-hidden">选择算法</caption>
        <thead>
          <tr>
            <th scope="col" className="select-cell"><span className="visually-hidden">选择</span></th>
            <th scope="col">算法</th>
            <th scope="col" className="col-optional">说明</th>
            <th scope="col" className="col-optional">通信内容</th>
            <th scope="col">产出</th>
          </tr>
        </thead>
        <tbody>
          {algorithms.map((item) => {
            const checked = value === item.id;
            const inputId = `algorithm-${item.id}`;
            return (
              <tr key={item.id} className={`select-row${checked ? " select-row--checked" : ""}`} onClick={rowToggle(true, () => onChange(item.id))}>
                <td className="select-cell"><input id={inputId} type="radio" name="algorithm" checked={checked} onChange={() => onChange(item.id)} /></td>
                <th scope="row" className="nowrap-cell"><label htmlFor={inputId}>{item.name}</label><small translate="no">{item.fullName}</small></th>
                <td className="col-optional">{item.summary}</td>
                <td className="col-optional nowrap-cell">{item.exchange}</td>
                <td className="nowrap-cell">{item.output.name}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 点行里任意位置都能选中；点到输入框、下拉框和标签时交给浏览器处理，避免切换两次。 */
function rowToggle(enabled: boolean, toggle: () => void) {
  return (event: MouseEvent<HTMLTableRowElement>) => {
    if (!enabled || (event.target as HTMLElement).closest("input, select, label, a, button")) return;
    toggle();
  };
}

type Candidate = { participant: Participant; datasets: Dataset[] };

/**
 * 参与方：带复选框的表格，一行一个参与方，表头可以全选。每个参与方出一份数据集，
 * 名下有几份能用的数据集时在行里选用哪一份。还不能参加的（等待连接、离线）写明状态，并能点进去查看。
 */
function ParticipantTable({ draft, dispatch, candidates }: { draft: Draft; dispatch: Dispatch<Action>; candidates: readonly Candidate[] }) {
  const head = useRef<HTMLInputElement>(null);
  const picks = new Map(draft.participants.map((item) => [item.participantId, item.datasetId]));
  const online = candidates.filter((item) => item.participant.status === "online");
  const chosen = online.filter((item) => picks.has(item.participant.id)).length;
  const all = online.length > 0 && chosen === online.length;
  const some = !all && chosen > 0;
  // 能选的排在前面，还不能参加的放在后面。
  const rows = [...candidates].sort((a, b) => Number(a.participant.status !== "online") - Number(b.participant.status !== "online"));

  useEffect(() => {
    if (head.current) head.current.indeterminate = some;
  }, [some]);

  function selectAll() {
    dispatch({
      type: "setParticipants",
      participants: all ? [] : online.map(({ participant, datasets }) => ({ participantId: participant.id, datasetId: picks.get(participant.id) ?? datasets[0].id })),
    });
  }

  return (
    <div className="table-shell">
      <table className="table table--select">
        <caption className="visually-hidden">选择参加任务的参与方</caption>
        <thead>
          <tr>
            <th scope="col" className="select-cell">
              <input ref={head} type="checkbox" aria-label="全选" checked={all} disabled={!online.length} onChange={selectAll} />
            </th>
            <th scope="col">参与方</th>
            {/* 手机上也要看得到、选得了数据集，收起的是样本数和运行位置 */}
            <th scope="col">数据集</th>
            <th scope="col" className="numeric col-optional">样本</th>
            <th scope="col" className="col-optional">运行位置</th>
            <th scope="col">状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ participant, datasets }) => {
            const enabled = participant.status === "online";
            const pickedId = picks.get(participant.id);
            const checked = enabled && pickedId !== undefined;
            const shown = datasets.find((dataset) => dataset.id === pickedId) ?? datasets[0];
            const toggle = () => dispatch({ type: "pickDataset", participantId: participant.id, datasetId: checked ? null : shown.id });
            const inputId = `pick-${participant.id}`;
            return (
              <tr key={participant.id} className={`select-row${checked ? " select-row--checked" : ""}${enabled ? "" : " select-row--disabled"}`} onClick={rowToggle(enabled, toggle)}>
                <td className="select-cell"><input id={inputId} type="checkbox" checked={checked} disabled={!enabled} onChange={toggle} /></td>
                <th scope="row"><label htmlFor={inputId}>{participant.name}</label></th>
                <td>
                  {datasets.length > 1 ? (
                    <select
                      className="cell-select"
                      name={`dataset-${participant.id}`}
                      aria-label={`${participant.name} 用的数据集`}
                      value={shown.id}
                      disabled={!enabled}
                      // 选了数据集就是要让这个参与方参加。
                      onChange={(event) => dispatch({ type: "pickDataset", participantId: participant.id, datasetId: event.target.value })}
                    >
                      {datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
                    </select>
                  ) : shown.name}
                </td>
                <td className="numeric col-optional">{shown.source === "local" ? "—" : formatNumber(shown.count)}</td>
                <td className="col-optional">{HOSTING_LABELS[participant.hosting]}</td>
                <td>
                  {enabled ? <span className="status-text">可用</span> : (
                    <span className="cell-title">
                      <Tag tone="warning">{PARTICIPANT_STATUS[participant.status]}</Tag>
                      <a className="text-link" href={hrefOf({ page: "participants", id: participant.id })}>查看</a>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const MODES: readonly { value: RunMode; label: string }[] = [
  { value: "trial", label: "试跑" },
  { value: "full", label: "正式运行" },
];

/** 服务端有没有调用模型的步骤；没有的算法不用选服务端模型。 */
function serverUsesModel(algorithm: Algorithm): boolean {
  return algorithm.stages.some((stage) => stage.side === "server" && stage.model);
}

function RunSettings({
  state, draft, update, algorithm,
}: {
  state: State;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  algorithm: Algorithm;
}) {
  const options = modelOptions(state.endpoints);
  const rounds = Array.from({ length: algorithm.maxRounds - algorithm.minRounds + 1 }, (_, index) => algorithm.minRounds + index);

  return (
    <div className="form-body">
      <FieldGroup>
        <Field label="运行方式" labelId="mode-label">
          <Choices labelledBy="mode-label" value={draft.mode} options={MODES} onChange={(mode) => update({ mode })} />
        </Field>
        {draft.mode === "trial" ? (
          <Field label="试跑样本数" htmlFor="trial-cap">
            <UnitInput id="trial-cap" unit="条 / 数据集" name="trial-cap" type="number" inputMode="numeric" autoComplete="off" min={1} max={50} value={draft.trialCap} onChange={(event) => update({ trialCap: clampInt(event.target.value, 1, 50, draft.trialCap) })} />
          </Field>
        ) : null}
        <Field label="轮次" labelId="rounds-label" wide info={`第 1 轮各方单独作答，作为本地基线；之后每轮都带上上一轮的${algorithm.output.name}再作答。`}>
          <Choices labelledBy="rounds-label" value={draft.rounds} options={rounds.map((value) => ({ value, label: `${value} 轮` }))} onChange={(value) => update({ rounds: value })} />
        </Field>
        {options.length === 1 ? (
          <ModelField state={state} />
        ) : (
          <>
            <Field label="参与方模型" htmlFor="client-model">
              <select id="client-model" name="client-model" value={draft.clientModel} onChange={(event) => update({ clientModel: event.target.value })}>
                {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
              </select>
            </Field>
            {serverUsesModel(algorithm) ? (
              <Field label="服务端模型" htmlFor="server-model" info="服务端每轮要读完各方上传的内容，需要长上下文的模型。">
                <select id="server-model" name="server-model" value={draft.serverModel} onChange={(event) => update({ serverModel: event.target.value })}>
                  {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
                </select>
              </Field>
            ) : null}
          </>
        )}
      </FieldGroup>
    </div>
  );
}

/** 只有一个模型可用时不做成下拉：参与方和服务端都用它；接口还没配置时给出去配置的入口。 */
function ModelField({ state }: { state: State }) {
  const endpoint = state.endpoints.find((item) => item.id === DEFAULT_ENDPOINT_ID);
  return (
    <Field label="模型" wide>
      <p className="field-static">
        <span>{modelLabel(DEFAULT_MODEL, state.endpoints)}</span>
        {endpoint && !isConfigured(endpoint) ? <a className="text-link" href={hrefOf(endpointRoute(endpoint.id))}>去配置</a> : null}
      </p>
    </Field>
  );
}

const GENERAL_KEYS = ["seed", "workers"] as const;

/** 高级配置默认收起：算法参数按注册表生成，另有几项通用设置。 */
function AdvancedPanel({
  state, draft, update, algorithm, joined,
}: {
  state: State;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  algorithm: Algorithm;
  /** 已选的参与方 id。 */
  joined: readonly string[];
}) {
  const changed = algorithm.params.filter((def) => paramValue(def, draft.params) !== def.default).length
    + GENERAL_KEYS.filter((key) => draft[key] !== DEFAULT_DRAFT[key]).length
    + Object.keys(activeOverrides(draft)).length;
  // 只有一个模型时没有可指定的，不显示这一项。
  const canOverride = modelOptions(state.endpoints).length > 1;
  return (
    <Collapsible
      className="panel panel--collapsible"
      title={<>高级配置{changed ? <Tag tone="info">已改 {changed} 项</Tag> : null}</>}
      sub="可选，默认值即推荐值"
    >
      <div className="form-body">
        <FieldGroup title={`${algorithm.name} 算法参数`}>
          {algorithm.params.map((def) => (
            <ParamField key={def.key} def={def} params={draft.params} onChange={(value) => update({ params: { ...draft.params, [def.key]: value } })} />
          ))}
        </FieldGroup>
        <FieldGroup title="通用">
          <Field label="并发数" htmlFor="workers" info="同时发出的模型调用数，所有参与方共用。">
            <input id="workers" name="workers" type="number" inputMode="numeric" autoComplete="off" min={1} max={64} value={draft.workers} onChange={(event) => update({ workers: clampInt(event.target.value, 1, 64, draft.workers) })} />
          </Field>
          <Field label="随机种子" htmlFor="seed" info="固定种子后，同样的配置可以复现同样的结果。">
            <input id="seed" name="seed" type="number" inputMode="numeric" autoComplete="off" min={0} value={draft.seed} onChange={(event) => update({ seed: clampInt(event.target.value, 0, 1_000_000, draft.seed) })} />
          </Field>
          {canOverride ? (
            <Field label="单独指定模型" labelId="overrides-label" wide>
              <ModelOverrides state={state} draft={draft} update={update} joined={joined} />
            </Field>
          ) : null}
        </FieldGroup>
      </div>
    </Collapsible>
  );
}

/** 按注册表里的参数定义生成一个字段：下拉或数字输入；解释来自注册表，点"说明"才展开。 */
function ParamField({ def, params, onChange }: { def: ParamDef; params: Params; onChange: (value: ParamValue) => void }) {
  const id = `param-${def.key}`;
  const value = paramValue(def, params);
  if (def.kind === "number") {
    const current = typeof value === "number" ? value : def.default;
    return (
      <Field label={def.label} htmlFor={id} info={def.help}>
        <UnitInput id={id} unit={def.unit} name={def.key} type="number" inputMode="numeric" autoComplete="off" min={def.min} max={def.max} value={current} onChange={(event) => onChange(clampInt(event.target.value, def.min, def.max, current))} />
      </Field>
    );
  }
  if (def.kind === "select-number") {
    return (
      <Field label={def.label} htmlFor={id} info={def.help}>
        <select id={id} name={def.key} value={value ?? ""} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}>
          {def.options.map((option) => <option key={String(option.value)} value={option.value ?? ""}>{option.label}</option>)}
        </select>
      </Field>
    );
  }
  return (
    <Field label={def.label} htmlFor={id} info={def.help}>
      <select id={id} name={def.key} value={String(value ?? def.default)} onChange={(event) => onChange(event.target.value)}>
        {def.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </Field>
  );
}

/** 默认所有参与方用同一个模型；需要时逐条添加例外。每条一行：参与方、模型、移除。 */
function ModelOverrides({
  state, draft, update, joined,
}: {
  state: State;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  joined: readonly string[];
}) {
  const options = modelOptions(state.endpoints);
  const overrides = activeOverrides(draft);
  const entries = Object.entries(overrides).filter(([id]) => joined.includes(id));
  const free = joined.filter((id) => !(id in overrides));
  const nameOf = (id: string) => participantOf(state, id)?.name ?? id;
  const set = (next: Record<string, string>) => update({ clientOverrides: next });

  if (!joined.length) return <p className="field-static">先在“参与方”里选择参与方</p>;
  return (
    <div className="override-editor">
      {entries.length ? (
        <div className="override-list" role="group" aria-labelledby="overrides-label">
          <div className="override-row override-head" aria-hidden="true"><span>参与方</span><span>模型</span><span /></div>
          {entries.map(([participantId, ref]) => (
            <div key={participantId} className="override-row">
              <select
                aria-label="参与方"
                value={participantId}
                onChange={(event) => {
                  const next = { ...overrides };
                  delete next[participantId];
                  set({ ...next, [event.target.value]: ref });
                }}
              >
                {[participantId, ...free].map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
              </select>
              <select aria-label={`${nameOf(participantId)} 使用的模型`} value={ref} onChange={(event) => set({ ...overrides, [participantId]: event.target.value })}>
                {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
              </select>
              <button
                type="button"
                className="button button--ghost"
                aria-label={`移除 ${nameOf(participantId)} 的单独设置`}
                onClick={() => {
                  const next = { ...overrides };
                  delete next[participantId];
                  set(next);
                }}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {free.length ? (
        <button type="button" className="button button--secondary button--compact" onClick={() => set({ ...overrides, [free[0]]: draft.clientModel })}>
          <Icon name="plus" />为某个参与方指定
        </button>
      ) : null}
    </div>
  );
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function modelSummary(draft: Draft, state: State, algorithm: Algorithm): string {
  const client = modelLabel(draft.clientModel, state.endpoints);
  if (!serverUsesModel(algorithm)) return client;
  const server = modelLabel(draft.serverModel, state.endpoints);
  return client === server ? client : `参与方 ${client}；服务端 ${server}`;
}

function EstimateBlock({ result, priceHref }: { result: Estimate; priceHref: string }) {
  return (
    <div className="summary-estimate">
      <h3>预估</h3>
      <dl className="summary-list">
        <div><dt>参与方调用</dt><dd>{formatNumber(result.participantCalls)} 次</dd></div>
        <div><dt>服务端调用</dt><dd>至少 {result.serverCalls} 次</dd></div>
        <div><dt>Token</dt><dd>约 {formatTokens(result.participantTokens + result.serverTokens)}</dd></div>
        <div><dt>时长</dt><dd>{formatDuration(result.seconds)}</dd></div>
        <div><dt>费用</dt><dd>{result.cost === null ? <a className="text-link" href={priceHref}>未设置单价</a> : formatYuan(result.cost)}</dd></div>
      </dl>
    </div>
  );
}
