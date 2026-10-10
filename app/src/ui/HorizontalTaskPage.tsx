import { SelectField } from "./SelectField";
import { ModelPicker } from "./ModelPicker";
import { InfoTip } from "./InfoTip";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type Dispatch, type MouseEvent } from "react";
import { api, ApiError, type TaskConfigIn } from "../api/client";
import {
  algorithmOf,
  algorithmsFor,
  paramValue,
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
  joinable,
  type Draft,
  type Estimate,
  type Issue,
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
  type Dataset,
  type Participant,
} from "../domain/resources";
import { createTask, taskRequest } from "../state/actions";
import { flashFor, showFlash } from "../state/flash";
import { hrefOf, navigate, type Route } from "../state/route";
import { datasetsOf, participantOf, type Action, type State } from "../state/store";
import { Collapsible, Confirm, Meta, Notice, PageHead, PanelEmpty, Tag } from "./common";
import { Choices, Field, FieldGroup, Panel, UnitInput } from "./console";
import { formatDuration, formatNumber, formatTokens, formatYuan } from "./format";
import { useDebounced } from "./hooks";
import { Icon } from "./icons";
import { usageText } from "./labels";

type Props = { state: State; dispatch: Dispatch<Action> };

/** 这个配置页只用于横向联邦：每个场景要配置的东西不同，各有自己的配置页。 */
const SCENARIO: ScenarioId = "horizontal";

/** 从新建任务出发去新增参与方、数据集，配置接口，保存后回到这里。 */
const NEW_PARTICIPANT: Route = { page: "newParticipant", from: "newTask" };
const NEW_DATASET: Route = { page: "newDataset", from: "newTask" };
const endpointRoute = (id: string): Route => ({ page: "editEndpoint", id, from: "newTask" });

type Restored = { kind: "copy"; source: string } | { kind: "draft" } | null;
type Pending = "full" | "leave" | "restart" | null;

/**
 * 新建横向联邦任务：按云平台"创建实例"的方式，分区块配置，右侧是配置摘要和预估。
 * 横向联邦的任务是各方用同类任务、各自的数据协作，所以这里配置任务类型、算法、参与方（每方一份数据集）和运行方式。
 * 任务类型、算法、参数都来自注册表，页面不针对某个算法写死；每一步都由用户自己选，不替用户默认。
 * 从首页的横向联邦卡片、或"联邦任务"页横向联邦一栏的"新建联邦任务"进来，都是这一页。
 */
export default function HorizontalTaskPage({ state, dispatch }: Props) {
  const draft = state.draft;
  const back: Route = { page: "tasks" };
  // 没动过的草稿不保留：每次打开都按当前的参与方和数据重新选，默认名称也按这次打开的时间生成。
  const resetOnOpen = useRef(!draft.touched);
  const [openedAt] = useState(() => new Date());
  const [pending, setPending] = useState<Pending>(null);
  const issuesId = useId();
  // 打开时草稿里已经有用户的内容：要么是上次没填完，要么是从任务"复制为新任务"带过来的。
  // 从新增参与方、配置接口回来时顶部已经有结果提示，不再重复提示"已恢复"。
  const [restored, setRestored] = useState<Restored>(() => {
    if (!draft.touched || flashFor({ page: "newTask", scenario: SCENARIO })) return null;
    return draft.name?.endsWith("（副本）") ? { kind: "copy", source: draft.name.slice(0, -"（副本）".length) } : { kind: "draft" };
  });

  useEffect(() => {
    if (!resetOnOpen.current) return;
    resetOnOpen.current = false;
    dispatch({ type: "resetDraft" });
  }, [dispatch]);

  useEffect(() => {
    // 场景就是横向联邦：草稿里记下场景（已经是横向时不变），不算用户动过草稿。
    dispatch({ type: "chooseScenario", scenario: SCENARIO, auto: true });
  }, [dispatch]);

  const update = (patch: Partial<Draft>) => dispatch({ type: "updateDraft", patch });
  const algorithm = draft.algorithm ? algorithmOf(draft.algorithm) : null;
  // 能参加的参与方：名下有登记在这个场景、这种任务类型下的数据集。
  const scenarioId = draft.scenario;
  const taskType = draft.taskType;
  const candidates: Candidate[] = algorithm && scenarioId && taskType
    ? state.participants.flatMap((participant) => {
      if (participant.status !== "online") return [];
      const datasets = compatibleDatasets(scenarioId, taskType, datasetsOf(state, participant.id)).filter((dataset) => dataset.ready);
      return datasets.length ? [{ participant, datasets }] : [];
    })
    : [];
  const joined = joinable(draft, state.datasets, state.participants);
  const localIssues = draftIssues(draft, state.datasets, state.participants, state.endpoints);
  // 预估和最终的检查由后端做（插件声明的步骤、接口单价、模型接口是否配置好）；配置改动停下 0.3 秒后再问一次。
  const currentRequest = taskRequest(draft, "", state.datasets, state.participants);
  const request = useDebounced(currentRequest, 300);
  const requestCurrent = JSON.stringify(request) === JSON.stringify(currentRequest);
  const check = useQuery({
    queryKey: ["task-validate", request],
    queryFn: () => api.validateTask(request as TaskConfigIn),
    enabled: Boolean(request && request.participants.length),
    staleTime: 15_000,
  });
  const validationPending = !localIssues.length && (!requestCurrent || check.isPending || check.isFetching);
  const validationError = !localIssues.length && requestCurrent && check.error
    ? (check.error instanceof ApiError ? check.error.message : "无法检查配置，请稍后重试") : null;
  const serverIssues = localIssues.length || !requestCurrent || !request?.participants.length ? [] : (check.data?.issues ?? []);
  const issues: Issue[] = [...localIssues, ...serverIssues.map((issue) => issue as Issue).filter((issue) => !localIssues.some((item) => item.message === issue.message))];
  const result: Estimate | null = joined.length && requestCurrent && !check.error ? check.data?.estimate ?? null : null;
  const canCreate = !issues.length && !validationPending && !validationError && Boolean(result);
  const statusText = issues.length ? `还需要：${issues.map((issue) => issue.message).join("；")}`
    : validationError ? `检查失败：${validationError}` : validationPending ? "正在检查配置和预估用量…" : "";
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const full = draft.mode === "full";
  const autoName = defaultTaskName(draft, openedAt);
  const overrideCount = Object.keys(activeOverrides(draft)).length;
  const priceEndpoint = endpointOf(draft.clientModel, state.endpoints)?.id ?? DEFAULT_ENDPOINT_ID;

  async function create() {
    if (!canCreate || creating) return;
    const body = taskRequest(draft, draft.name?.trim() || defaultTaskName(draft, new Date()), state.datasets, state.participants);
    if (!body) return;
    setCreating(true);
    setCreateError(null);
    try {
      const task = await createTask(body);
      dispatch({ type: "resetDraft" });
      showFlash({ page: "task", id: task.id }, full ? `已创建“${task.name}”，开始正式运行。` : `已创建“${task.name}”，开始试跑。`);
      navigate({ page: "task", id: task.id, tab: "progress" });
    } catch (error) {
      setCreateError(error instanceof ApiError ? error.message : "创建失败，稍后再试");
    } finally {
      setCreating(false);
    }
  }

  function restart() {
    dispatch({ type: "resetDraft" });
    setPending(null);
    setRestored(null);
    setCreateError(null);
    dispatch({ type: "chooseScenario", scenario: SCENARIO, auto: true });
  }

  function leave() {
    dispatch({ type: "resetDraft" });
    navigate(back);
  }

  /** 正式运行调用量大，先确认一次；试跑直接开始。 */
  function start() {
    if (!canCreate || creating) return;
    if (full) { setCreateError(null); setPending("full"); }
    else void create();
  }

  /** 动过的草稿要确认才放弃；没动过的直接离开。 */
  function cancel() {
    if (draft.touched) setPending("leave");
    else navigate(back);
  }

  const startLabel = full ? "创建并正式运行" : "创建并试跑";
  const cost = result ? (result.cost === null ? "费用无法估算（没有设置单价）" : `费用${formatYuan(result.cost)}`) : "";
  // 确认条里的数字按段排版（Meta），不会把"3 轮"拆成两行。
  const confirm = pending === "full" && result && canCreate
    ? {
      title: "开始正式运行？",
      text: (
        <>
          <Meta parts={[`${joined.length} 个参与方`, `${formatNumber(result.problems)} 条样本`, `${draft.rounds} 轮`]} />
          <Meta parts={[formatDuration(result.seconds), cost]} />
          <span>创建后配置不能修改，运行中可以暂停或取消。</span>
        </>
      ),
      confirmLabel: "确认开始",
      cancelLabel: "取消",
      tone: "primary" as const,
      onConfirm: create,
    }
    : pending === "leave"
      ? {
        title: "放弃这次的配置？",
        text: "已选的参与方和设置都会清空。",
        confirmLabel: "放弃",
        cancelLabel: "继续编辑",
        tone: "danger" as const,
        onConfirm: leave,
      }
      : pending === "restart"
        ? {
          title: "重置这次的配置？",
          text: "任务名称、已选的任务类型、算法、参与方和设置都会恢复到初始状态。",
          confirmLabel: "重置",
          cancelLabel: "继续编辑",
          tone: "danger" as const,
          onConfirm: restart,
        }
        : null;

  return (
    <>
      <PageHead title="新建横向联邦任务" crumbs={[{ label: "联邦任务", route: back }]} />
      {createError && pending !== "full" ? <Notice tone="warning" onDismiss={() => setCreateError(null)}>没有创建：{createError}</Notice> : null}
      {restored && draft.scenario ? (
        <Notice onDismiss={() => setRestored(null)}>
          {restored.kind === "copy" ? `已带入“${restored.source}”的配置。` : "已恢复上次没填完的配置。"}
        </Notice>
      ) : null}

      <div className="order-layout task-config">
        <div className="order-main">
          <Panel title="任务配置" id="scenario" step={1}>
            <div className="form-body">
              <FieldGroup>
                <Field label="任务名称" htmlFor="task-name" wide>
                  <input id="task-name" name="task-name" autoComplete="off" value={draft.name ?? autoName} placeholder={autoName} maxLength={60} onChange={(event) => update({ name: event.target.value })} />
                </Field>
                <TaskTypeChoice scenario={SCENARIO} value={draft.taskType} onChange={(taskType) => dispatch({ type: "chooseTaskType", taskType })} />
                <AlgorithmField scenario={SCENARIO} taskType={draft.taskType} value={draft.algorithm} onChange={(id) => dispatch({ type: "chooseAlgorithm", algorithm: id })} />
              </FieldGroup>
            </div>
          </Panel>

          <Panel
            title="参与方"
            id="participants"
            step={2}
            extra={algorithm ? `已选 ${joined.length} 个` : "待选择"}
            actions={(
              <>
                <a className="button button--secondary button--compact" href={hrefOf(NEW_DATASET)}><Icon name="plus" />新增数据集</a>
                <a className="button button--secondary button--compact" href={hrefOf(NEW_PARTICIPANT)}><Icon name="plus" />新增参与方</a>
              </>
            )}
            flush
          >
            {!algorithm || !scenarioId || !taskType ? (
              <PanelEmpty>请先选择任务类型和算法，再勾选参与方及其数据集。</PanelEmpty>
            ) : candidates.length ? (
              <ParticipantTable draft={draft} dispatch={dispatch} candidates={candidates} />
            ) : (
              <PanelEmpty>暂无可用于“{usageText(scenarioId, taskType)}”的参与方。</PanelEmpty>
            )}
          </Panel>

          <Panel title="运行配置" id="settings" step={3}>
            <RunSettings state={state} draft={draft} update={update} algorithm={algorithm} />
          </Panel>

          <AdvancedPanel state={state} draft={draft} update={update} algorithm={algorithm} joined={joined.map((item) => item.participantId)} />
          <div className="task-config-actions">
            <button type="button" className="button button--secondary" disabled={!draft.touched || creating} onClick={() => setPending("restart")}>
              重置配置
            </button>
          </div>
        </div>

        <aside className="order-summary" aria-label="配置摘要" id="task-summary">
          <Panel title="配置摘要" className="summary-panel">
            <dl className="summary-list">
              <div><dt>场景</dt><dd>{draft.scenario ? scenarioOf(draft.scenario).short : "—"}</dd></div>
              <div><dt>任务类型</dt><dd>{draft.taskType ? TASK_TYPES[draft.taskType].label : "—"}</dd></div>
              <div><dt>算法</dt><dd>{algorithm ? algorithm.name : "—"}</dd></div>
              <div><dt>参与方</dt><dd>{joined.length ? `${joined.length} 个` : "—"}</dd></div>
              <div><dt>样本</dt><dd>{result ? `${formatNumber(result.problems)} 条${full ? "" : `（每份前 ${draft.trialCap} 条）`}` : "—"}</dd></div>
              <div><dt>运行</dt><dd>{full ? "正式运行" : "试跑"} · {algorithm ? `${draft.rounds} 轮` : "轮次待选"}</dd></div>
              <div><dt>模型</dt><dd>{algorithm ? modelSummary(draft, state, algorithm) : modelLabel(draft.clientModel, state.endpoints)}</dd></div>
              {overrideCount ? <div><dt>单独指定</dt><dd>{overrideCount} 个参与方</dd></div> : null}
            </dl>
            {result ? <EstimateBlock result={result} priceHref={hrefOf(endpointRoute(priceEndpoint))} /> : null}
            <div className="summary-actions">
              <button type="button" className="button button--primary button--block summary-start" disabled={!canCreate || creating} aria-describedby={statusText ? issuesId : undefined} onClick={start}>{creating ? "正在创建…" : startLabel}</button>
              <button type="button" className="button button--ghost button--block" disabled={creating} onClick={cancel}>取消</button>
            </div>
            <p className="summary-issues" id={issuesId} aria-live="polite">{statusText}</p>
            {validationError ? <button type="button" className="link-button" onClick={() => void check.refetch()}>重新检查</button> : null}
          </Panel>
        </aside>
      </div>

      {confirm ? (
        <Confirm title={confirm.title} confirmLabel={confirm.confirmLabel} cancelLabel={confirm.cancelLabel} tone={confirm.tone} onConfirm={confirm.onConfirm} onCancel={() => setPending(null)} error={pending === "full" ? createError : undefined}>
          {confirm.text}
        </Confirm>
      ) : null}
      <div className="order-bar" aria-label="创建任务">
        <div>
          <strong className={issues.length || validationError ? "order-bar-issue" : undefined}>{statusText || `${joined.length} 个参与方 · 至少 ${formatNumber((result?.participantCalls ?? 0) + (result?.serverCalls ?? 0))} 次调用`}</strong>
          {result && !issues.length ? <small>{formatDuration(result.seconds)}</small> : null}
        </div>
        <div className="order-bar-actions">
          <button type="button" className="button button--ghost order-bar-cancel" disabled={creating} onClick={cancel}>取消</button>
          <button type="button" className="button button--primary" disabled={!canCreate || creating} onClick={start}>{creating ? "正在创建…" : startLabel}</button>
        </div>
      </div>
    </>
  );
}

/** 任务类型：列出这个场景里有算法能处理的类型，由用户选；指标跟着任务类型走。最后留一个"待接入"的空位。 */
function TaskTypeChoice({ scenario, value, onChange }: { scenario: ScenarioId; value: TaskType | null; onChange: (type: TaskType) => void }) {
  const types = taskTypesFor(scenario);
  return (
    <Field label="任务类型" labelId="task-type-label" wide info="任务类型决定数据格式、评估指标，以及可选择的算法与参与方数据。">
      {types.length ? (
        <Choices labelledBy="task-type-label" value={value} options={types.map((type) => ({ value: type, label: TASK_TYPES[type].label }))} placeholder="更多类型" onChange={onChange} />
      ) : <p className="field-static">这个场景还没有可用的任务类型。</p>}
    </Field>
  );
}

/** 算法按注册表列出；短名称供选择，说明、交换内容与产出通过 ⓘ 查看。 */
function AlgorithmField({ scenario, taskType, value, onChange }: { scenario: ScenarioId; taskType: TaskType | null; value: Draft["algorithm"]; onChange: (id: Algorithm["id"]) => void }) {
  const algorithms = algorithmsFor(scenario, taskType);
  return (
    <Field label="算法" labelId="algorithm-label" wide>
      {!taskType ? <p className="field-static" id="algorithm-prerequisite">请先选择任务类型</p> : null}
      {algorithms.length ? <AlgorithmTable algorithms={algorithms} value={value} onChange={onChange} disabled={!taskType} /> : <p className="field-static">这种任务类型在这个场景下还没有算法。</p>}
    </Field>
  );
}

/** 算法短名称等宽选择，详细说明通过独立 ⓘ 浮层查看。 */
function AlgorithmTable({ algorithms, value, onChange, disabled }: { algorithms: readonly Algorithm[]; value: Draft["algorithm"]; onChange: (id: Algorithm["id"]) => void; disabled: boolean }) {
  return (
    <div className="algorithm-options" role="radiogroup" aria-labelledby="algorithm-label">
      {algorithms.map((item) => (
        <div key={item.id} className={`algorithm-choice${value === item.id ? " algorithm-choice--checked" : ""}${disabled ? " algorithm-choice--disabled" : ""}`}>
          <label className="algorithm-choice-main" htmlFor={`algorithm-${item.id}`}>
            <input id={`algorithm-${item.id}`} type="radio" name="algorithm" checked={value === item.id} disabled={disabled}
              aria-label={item.name} aria-describedby={disabled ? "algorithm-prerequisite" : undefined} onChange={() => onChange(item.id)} />
            <span>{item.name}</span>
          </label>
          <InfoTip label={item.name}>
            <strong>{item.fullName}</strong>
            <p>{item.summary}</p>
            <dl className="algorithm-tip-facts"><div><dt>交换内容</dt><dd>{item.exchange}</dd></div><div><dt>产出</dt><dd>{item.output.name}</dd></div></dl>
          </InfoTip>
        </div>
      ))}
      <div className="algorithm-choice algorithm-choice--placeholder" aria-disabled="true">
        <label className="algorithm-choice-main"><input type="radio" name="algorithm" disabled aria-label="更多算法（待接入）" /><span>更多算法</span></label>
        <Tag>待接入</Tag>
      </div>
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
 * 只展示在线且有匹配、已就绪数据集的参与方，多份可用数据集在行内选择。
 */
function ParticipantTable({ draft, dispatch, candidates }: { draft: Draft; dispatch: Dispatch<Action>; candidates: readonly Candidate[] }) {
  const head = useRef<HTMLInputElement>(null);
  const picks = new Map(draft.participants.map((item) => [item.participantId, item.datasetId]));
  const open = candidates.map(({ participant, datasets }) => ({ participant, ready: datasets, picked: datasets.find((dataset) => dataset.id === picks.get(participant.id)) }));
  const chosen = open.filter((row) => row.picked).length;
  const all = open.length > 0 && chosen === open.length;
  const some = !all && chosen > 0;

  useEffect(() => {
    if (head.current) head.current.indeterminate = some;
  }, [some]);

  function selectAll() {
    dispatch({
      type: "setParticipants",
      participants: all ? [] : open.map(({ participant, ready, picked }) => ({ participantId: participant.id, datasetId: (picked ?? ready[0]).id })),
    });
  }

  return (
    <div className="table-shell">
      <table className="table table--select">
        <caption className="visually-hidden">选择参加任务的参与方</caption>
        <thead>
          <tr>
            <th scope="col" className="select-cell">
              <input ref={head} type="checkbox" aria-label="全选" checked={all} disabled={!open.length} onChange={selectAll} />
            </th>
            <th scope="col">参与方</th>
            {/* 手机上也要看得到、选得了数据集，收起的是样本数和运行位置 */}
            <th scope="col">数据集</th>
            <th scope="col" className="numeric col-optional">样本</th>
            <th scope="col" className="col-optional">运行位置</th>
          </tr>
        </thead>
        <tbody>
          {open.map(({ participant, ready, picked }) => {
            const checked = picked !== undefined;
            const choices = ready;
            const shown = picked ?? choices[0];
            const toggle = () => dispatch({ type: "pickDataset", participantId: participant.id, datasetId: checked ? null : shown.id });
            const inputId = `pick-${participant.id}`;
            return (
              <tr key={participant.id} className={`select-row${checked ? " select-row--checked" : ""}`} onClick={rowToggle(true, toggle)}>
                <td className="select-cell"><input id={inputId} type="checkbox" checked={checked} onChange={toggle} /></td>
                <th scope="row"><label htmlFor={inputId}>{participant.name}</label></th>
                <td>
                  {choices.length > 1 ? (
                    <SelectField
                      className="cell-select"
                      name={`dataset-${participant.id}`}
                      aria-label={`${participant.name} 用的数据集`}
                      value={shown.id}
                      // 选了数据集就是要让这个参与方参加。
                      onValueChange={(value) => dispatch({ type: "pickDataset", participantId: participant.id, datasetId: value })}
                    >
                      {choices.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
                    </SelectField>
                  ) : shown.name}
                </td>
                <td className="numeric col-optional">{formatNumber(shown.count)}</td>
                <td className="col-optional">{HOSTING_LABELS[participant.hosting]}</td>
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
  algorithm: Algorithm | null;
}) {
  const options = modelOptions(state.endpoints);
  const rounds = algorithm ? Array.from({ length: algorithm.maxRounds - algorithm.minRounds + 1 }, (_, index) => algorithm.minRounds + index) : [];

  return (
    <div className="form-body">
      <FieldGroup>
        <Field label="运行方式" labelId="mode-label" info="试跑只使用每份数据集的前几条样本，适合先确认流程；正式运行使用所选数据集的全部样本。">
          <Choices labelledBy="mode-label" value={draft.mode} options={MODES} onChange={(mode) => update({ mode })} />
        </Field>
        <Field label="试跑样本数" htmlFor="trial-cap" info="每份数据集使用的样本上限，仅影响试跑。">
          <UnitInput id="trial-cap" unit="条 / 数据集" name="trial-cap" type="number" inputMode="numeric" autoComplete="off" min={1} max={50} value={draft.mode === "trial" ? draft.trialCap : ""} disabled={draft.mode !== "trial"} placeholder="全部样本" onChange={(event) => update({ trialCap: clampInt(event.target.value, 1, 50, draft.trialCap) })} />
        </Field>
        <Field label="轮次" htmlFor={algorithm ? undefined : "rounds-pending"} labelId="rounds-label" wide info={algorithm ? `第 1 轮各方单独作答，作为本地基线；之后每轮都带上上一轮的${algorithm.output.name}再作答。` : undefined}>
          {algorithm ? <Choices name="rounds" labelledBy="rounds-label" value={draft.rounds} options={rounds.map((value) => ({ value, label: `${value} 轮` }))} onChange={(value) => update({ rounds: value })} /> : (
            <SelectField id="rounds-pending" disabled value=""><option value="">请先选择算法</option></SelectField>
          )}
        </Field>
        {options.length === 1 ? (
          <ModelField state={state} />
        ) : (
          <>
            <Field label="参与方模型" htmlFor="client-model">
              <ModelPicker id="client-model" name="client-model" value={draft.clientModel} onValueChange={(value) => update({ clientModel: value })} options={options} endpoints={state.endpoints} />
            </Field>
            {!algorithm || serverUsesModel(algorithm) ? (
              <Field label="服务端模型" htmlFor="server-model" info="服务端每轮要读完各方上传的内容，需要长上下文的模型。">
                <ModelPicker id="server-model" name="server-model" value={draft.serverModel} onValueChange={(value) => update({ serverModel: value })} options={options} endpoints={state.endpoints} />
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
  algorithm: Algorithm | null;
  /** 已选的参与方 id。 */
  joined: readonly string[];
}) {
  const changed = (algorithm?.params.filter((def) => paramValue(def, draft.params) !== def.default).length ?? 0)
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
        <FieldGroup title={algorithm ? `${algorithm.name} 算法参数` : "算法参数"}>
          {algorithm ? algorithm.params.map((def) => (
            <ParamField key={def.key} def={def} params={draft.params} onChange={(value) => update({ params: { ...draft.params, [def.key]: value } })} />
          )) : <p className="field-static">请先选择算法</p>}
        </FieldGroup>
        <FieldGroup title="通用">
          <Field label="并发数" htmlFor="workers" info="同时发出的模型调用数，所有参与方共用。">
            <input id="workers" name="workers" type="number" inputMode="numeric" autoComplete="off" min={1} max={64} value={draft.workers} onChange={(event) => update({ workers: clampInt(event.target.value, 1, 64, draft.workers) })} />
          </Field>
          <Field label="随机种子" htmlFor="seed" info="记录在任务配置中；能否复现取决于算法和模型服务是否支持固定种子。">
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

/** 按注册表里的参数定义生成一个字段：下拉或数字输入；解释来自注册表，通过 ⓘ 浮层查看。 */
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
        <SelectField id={id} name={def.key} value={value ?? ""} onValueChange={(value) => onChange(value ? Number(value) : null)}>
          {def.options.map((option) => <option key={String(option.value)} value={option.value ?? ""}>{option.label}</option>)}
        </SelectField>
      </Field>
    );
  }
  return (
    <Field label={def.label} htmlFor={id} info={def.help}>
      <SelectField id={id} name={def.key} value={String(value ?? def.default)} onValueChange={(value) => onChange(value)}>
        {def.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </SelectField>
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
              <SelectField
                aria-label="参与方"
                value={participantId}
                onValueChange={(value) => {
                  const next = { ...overrides };
                  delete next[participantId];
                  set({ ...next, [value]: ref });
                }}
              >
                {[participantId, ...free].map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
              </SelectField>
              <ModelPicker aria-label={`${nameOf(participantId)} 使用的模型`} value={ref} onValueChange={(value) => set({ ...overrides, [participantId]: value })} options={options} endpoints={state.endpoints} />
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
