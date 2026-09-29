import { useEffect, useId, useRef, useState, type Dispatch, type MouseEvent } from "react";
import { algorithmOf, algorithmsFor, SCENARIOS, scenarioOf, TASK_TYPES, type Algorithm, type ParamDef, type ScenarioId } from "../domain/catalog";
import {
  activeOverrides,
  compatibleDatasets,
  DEFAULT_DRAFT,
  defaultTaskName,
  draftIssues,
  estimate,
  toConfig,
  type Draft,
  type Estimate,
  type RunMode,
} from "../domain/config";
import { DEFAULT_ENDPOINT_ID, DEFAULT_MODEL, endpointOf, HOSTING_LABELS, isConfigured, modelLabel, modelOptions, PARTICIPANT_STATUS, usable, type Dataset } from "../domain/resources";
import { flashFor, showFlash } from "../state/flash";
import { newId } from "../state/ids";
import { hrefOf, navigate, type Route } from "../state/route";
import { participantOf, type Action, type State } from "../state/store";
import { Collapsible, Confirm, Meta, Notice, PageHead, Tag } from "./common";
import { Choices, Field, FieldGroup, Panel, UnitInput } from "./console";
import { formatDuration, formatNumber, formatTokens, formatYuan } from "./format";
import { Icon } from "./icons";

type Props = { state: State; dispatch: Dispatch<Action>; scenario?: ScenarioId };

/** 从新建任务出发去新增参与方、配置接口，保存后回到这里。 */
const NEW_PARTICIPANT: Route = { page: "newParticipant", from: "newTask" };
const endpointRoute = (id: string): Route => ({ page: "editEndpoint", id, from: "newTask" });

type Restored = { kind: "copy"; source: string } | { kind: "draft" } | null;
type Pending = "full" | "leave" | "restart" | null;

/**
 * 新建联邦任务：按云平台"创建实例"的方式，分区块配置，右侧是配置摘要和预估。
 * 场景、算法、任务类型、参数都来自注册表，页面不针对某个算法写死。
 */
export default function NewTaskPage({ state, dispatch, scenario }: Props) {
  const draft = state.draft;
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

  useEffect(() => {
    // 只有一个场景可用时直接选上。
    if (draft.scenario || (scenario && scenarioOf(scenario).status === "available")) return;
    const available = SCENARIOS.filter((item) => item.status === "available");
    if (available.length === 1) dispatch({ type: "chooseScenario", scenario: available[0].id, auto: true });
  }, [scenario, draft.scenario, dispatch]);

  const update = (patch: Partial<Draft>) => dispatch({ type: "updateDraft", patch });
  const algorithm = draft.algorithm ? algorithmOf(draft.algorithm) : null;
  const candidates = algorithm ? compatibleDatasets(algorithm.id, state.datasets) : [];
  const selected = candidates.filter((dataset) => draft.datasetIds.includes(dataset.id) && usable(dataset, state.participants));
  const issues = draftIssues(draft, state.datasets, state.participants, state.endpoints);
  const config = toConfig(draft);
  const result = config && selected.length ? estimate(config, state.datasets, state.endpoints) : null;
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
    navigate({ page: "tasks" });
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
    else navigate({ page: "tasks" });
  }

  const startLabel = full ? "创建并正式运行" : "创建并试跑";
  const cost = result ? (result.cost === null ? "费用无法估算（没有设置单价）" : `费用${formatYuan(result.cost)}`) : "";
  // 确认条里的数字按段排版（Meta），不会把"3 轮"拆成两行。
  const confirm = pending === "full" && result && !issues.length
    ? {
      title: "开始正式运行？",
      text: (
        <>
          <Meta parts={[`${selected.length} 个参与方`, `${formatNumber(result.problems)} 条样本`, `${draft.rounds} 轮`]} />
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
      <PageHead title="新建联邦任务" crumbs={[{ label: "联邦任务", route: { page: "tasks" } }]} />
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

          <Panel title="场景与算法" id="scenario">
            <div className="form-body">
              <FieldGroup>
                <Field label="场景" labelId="scenario-label" wide>
                  <Choices
                    labelledBy="scenario-label"
                    value={draft.scenario}
                    options={SCENARIOS.map((item) => ({ value: item.id, label: item.short, disabled: item.status !== "available", badge: item.status === "available" ? undefined : "规划中" }))}
                    onChange={(value) => dispatch({ type: "chooseScenario", scenario: value })}
                  />
                </Field>
                {draft.scenario ? <AlgorithmField scenario={draft.scenario} value={draft.algorithm} onChange={(id) => dispatch({ type: "chooseAlgorithm", algorithm: id })} /> : null}
                {algorithm ? (
                  <Field label="任务类型">
                    <p className="field-static">{algorithm.accepts.map((type) => TASK_TYPES[type].label).join("、")}</p>
                  </Field>
                ) : null}
              </FieldGroup>
            </div>
          </Panel>

          {algorithm ? (
            <Panel
              title="参与方与数据"
              id="data"
              extra={`已选 ${selected.length} 个`}
              actions={<a className="button button--secondary button--compact" href={hrefOf(NEW_PARTICIPANT)}><Icon name="plus" />新增参与方</a>}
              flush
            >
              <DataTable state={state} dispatch={dispatch} candidates={candidates} selected={selected} />
            </Panel>
          ) : null}

          {algorithm ? (
            <Panel title="运行配置" id="settings">
              <RunSettings state={state} draft={draft} update={update} algorithm={algorithm} />
            </Panel>
          ) : null}

          {algorithm ? <AdvancedPanel state={state} draft={draft} update={update} algorithm={algorithm} selected={selected} /> : null}
        </div>

        <aside className="order-summary" aria-label="配置摘要" id="task-summary">
          <Panel title="配置摘要" className="summary-panel">
            <dl className="summary-list">
              <div><dt>场景</dt><dd>{draft.scenario ? scenarioOf(draft.scenario).short : "—"}</dd></div>
              <div><dt>算法</dt><dd>{algorithm ? algorithm.name : "—"}</dd></div>
              <div><dt>参与方</dt><dd>{selected.length ? `${selected.length} 个` : "—"}</dd></div>
              {algorithm ? (
                <>
                  <div><dt>样本</dt><dd>{result ? `${formatNumber(result.problems)} 条${full ? "" : `（每份前 ${draft.trialCap} 条）`}` : "—"}</dd></div>
                  <div><dt>运行</dt><dd>{full ? "正式运行" : "试跑"} · {draft.rounds} 轮</dd></div>
                  <div><dt>模型</dt><dd>{modelSummary(draft, state)}</dd></div>
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
            <strong className={issues.length ? "order-bar-issue" : undefined}>{issues.length ? `还需要：${issues[0].message}` : `${selected.length} 个参与方 · 约 ${formatNumber(result?.participantCalls ?? 0)} 次调用`}</strong>
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

/**
 * 算法：场景下只有一个算法时直接写出来，不做成"只有一行的单选表格"；
 * 有多个时用带单选的表格，比较它们交换什么、产出什么。
 */
function AlgorithmField({ scenario, value, onChange }: { scenario: ScenarioId; value: Draft["algorithm"]; onChange: (id: Algorithm["id"]) => void }) {
  const algorithms = algorithmsFor(scenario);
  if (algorithms.length === 1) {
    const only = algorithms[0];
    return (
      <Field label="算法" wide>
        <p className="field-static"><span><strong>{only.name}</strong>（<span translate="no">{only.fullName}</span>）：{only.summary}</span></p>
      </Field>
    );
  }
  return (
    <Field label="算法" labelId="algorithm-label" wide>
      {algorithms.length ? <AlgorithmTable algorithms={algorithms} value={value} onChange={onChange} /> : <p className="field-static">这个场景的算法待接入。</p>}
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

/** 点行里任意位置都能选中；点到输入框和它的标签时交给浏览器处理，避免切换两次。 */
function rowToggle(enabled: boolean, toggle: () => void) {
  return (event: MouseEvent<HTMLTableRowElement>) => {
    if (!enabled || (event.target as HTMLElement).closest("input, label, a, button")) return;
    toggle();
  };
}

/** 参与方与数据：带复选框的表格，表头可以全选；还不能参加的参与方写明状态，并能点进去查看。 */
function DataTable({
  state, dispatch, candidates, selected,
}: {
  state: State;
  dispatch: Dispatch<Action>;
  candidates: Dataset[];
  selected: Dataset[];
}) {
  const head = useRef<HTMLInputElement>(null);
  const usableIds = candidates.filter((dataset) => usable(dataset, state.participants)).map((dataset) => dataset.id);
  // 能选的排在前面，还不能参加的（等待连接、离线）放在后面。
  const rows = [...candidates].sort((a, b) => Number(!usable(a, state.participants)) - Number(!usable(b, state.participants)));
  const chosen = new Set(selected.map((dataset) => dataset.id));
  const all = usableIds.length > 0 && usableIds.every((id) => chosen.has(id));
  const some = !all && selected.length > 0;

  useEffect(() => {
    if (head.current) head.current.indeterminate = some;
  }, [some]);

  const waiting = state.participants.filter((participant) => participant.status !== "online" && !state.datasets.some((dataset) => dataset.participantId === participant.id));

  return (
    <div className="table-shell">
      <table className="table table--select">
        <caption className="visually-hidden">选择参加任务的参与方</caption>
        <thead>
          <tr>
            <th scope="col" className="select-cell">
              <input ref={head} type="checkbox" aria-label="全选" checked={all} disabled={!usableIds.length} onChange={() => dispatch({ type: "setDatasets", datasetIds: all ? [] : usableIds })} />
            </th>
            <th scope="col">参与方</th>
            <th scope="col" className="col-optional">数据集</th>
            <th scope="col" className="numeric">样本</th>
            <th scope="col" className="col-optional">运行位置</th>
            <th scope="col">状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((dataset) => {
            const owner = participantOf(state, dataset.participantId);
            const enabled = usable(dataset, state.participants);
            const checked = enabled && chosen.has(dataset.id);
            const toggle = () => dispatch({ type: "toggleDataset", datasetId: dataset.id });
            const inputId = `pick-${dataset.id}`;
            return (
              <tr key={dataset.id} className={`select-row${checked ? " select-row--checked" : ""}${enabled ? "" : " select-row--disabled"}`} onClick={rowToggle(enabled, toggle)}>
                <td className="select-cell"><input id={inputId} type="checkbox" checked={checked} disabled={!enabled} onChange={toggle} /></td>
                <th scope="row"><label htmlFor={inputId}>{owner?.name ?? dataset.name}</label></th>
                <td className="col-optional">{dataset.description || dataset.name}</td>
                <td className="numeric">{dataset.source === "local" ? "—" : formatNumber(dataset.count)}</td>
                <td className="col-optional">{owner ? HOSTING_LABELS[owner.hosting] : "—"}</td>
                <td>
                  {owner && owner.status !== "online" ? (
                    <span className="cell-title">
                      <Tag tone="warning">{PARTICIPANT_STATUS[owner.status]}</Tag>
                      <a className="text-link" href={hrefOf({ page: "participants", id: owner.id })}>查看</a>
                    </span>
                  ) : <span className="status-text">可用</span>}
                </td>
              </tr>
            );
          })}
          {waiting.map((participant) => (
            <tr key={participant.id} className="select-row select-row--disabled">
              <td className="select-cell"><input type="checkbox" disabled aria-label={`${participant.name}（${PARTICIPANT_STATUS[participant.status]}，暂不能选）`} /></td>
              <th scope="row">{participant.name}</th>
              <td className="col-optional">—</td>
              <td className="numeric">—</td>
              <td className="col-optional">{HOSTING_LABELS[participant.hosting]}</td>
              <td>
                <span className="cell-title">
                  <Tag tone="warning">{PARTICIPANT_STATUS[participant.status]}</Tag>
                  <a className="text-link" href={hrefOf({ page: "participants", id: participant.id })}>查看</a>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MODES: readonly { value: RunMode; label: string }[] = [
  { value: "trial", label: "试跑" },
  { value: "full", label: "正式运行" },
];

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
            <Field label="服务端模型" htmlFor="server-model" info="服务端每轮要读完各方上传的内容，需要长上下文的模型。">
              <select id="server-model" name="server-model" value={draft.serverModel} onChange={(event) => update({ serverModel: event.target.value })}>
                {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
              </select>
            </Field>
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

const ADVANCED_KEYS = ["insightTarget", "traceDensity", "maxTracesPerItem", "aggregationRetries", "seed", "workers"] as const;

/** 高级配置默认收起：算法参数按注册表生成，另有几项通用设置。 */
function AdvancedPanel({
  state, draft, update, algorithm, selected,
}: {
  state: State;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  algorithm: Algorithm;
  selected: Dataset[];
}) {
  const changed = ADVANCED_KEYS.filter((key) => draft[key] !== DEFAULT_DRAFT[key]).length + Object.keys(activeOverrides(draft)).length;
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
          {algorithm.params.map((def) => <ParamField key={def.key} def={def} draft={draft} update={update} />)}
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
              <ModelOverrides state={state} draft={draft} update={update} selected={selected} />
            </Field>
          ) : null}
        </FieldGroup>
      </div>
    </Collapsible>
  );
}

/** 按注册表里的参数定义生成一个字段：下拉或数字输入；解释来自注册表，点"说明"才展开。 */
function ParamField({ def, draft, update }: { def: ParamDef; draft: Draft; update: (patch: Partial<Draft>) => void }) {
  const id = `param-${def.key}`;
  if (def.kind === "number") {
    const value = draft[def.key];
    return (
      <Field label={def.label} htmlFor={id} info={def.help}>
        <UnitInput id={id} unit={def.unit} name={def.key} type="number" inputMode="numeric" autoComplete="off" min={def.min} max={def.max} value={value} onChange={(event) => update({ [def.key]: clampInt(event.target.value, def.min, def.max, value) })} />
      </Field>
    );
  }
  if (def.kind === "select-number") {
    const value = draft[def.key];
    return (
      <Field label={def.label} htmlFor={id} info={def.help}>
        <select id={id} name={def.key} value={value ?? ""} onChange={(event) => update({ [def.key]: event.target.value ? Number(event.target.value) : null })}>
          {def.options.map((option) => <option key={String(option.value)} value={option.value ?? ""}>{option.label}</option>)}
        </select>
      </Field>
    );
  }
  return (
    <Field label={def.label} htmlFor={id} info={def.help}>
      <select id={id} name={def.key} value={draft[def.key]} onChange={(event) => update({ [def.key]: event.target.value } as Partial<Draft>)}>
        {def.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </Field>
  );
}

/** 默认所有参与方用同一个模型；需要时逐条添加例外。每条一行：参与方、模型、移除。 */
function ModelOverrides({
  state, draft, update, selected,
}: {
  state: State;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  selected: Dataset[];
}) {
  const options = modelOptions(state.endpoints);
  const overrides = activeOverrides(draft);
  const entries = Object.entries(overrides);
  const free = selected.filter((dataset) => !(dataset.id in overrides));
  const nameOf = (dataset: Dataset) => participantOf(state, dataset.participantId)?.name ?? dataset.name;
  const set = (next: Record<string, string>) => update({ clientOverrides: next });

  if (!selected.length) return <p className="field-static">先在“参与方与数据”里选择参与方</p>;
  return (
    <div className="override-editor">
      {entries.length ? (
        <div className="override-list" role="group" aria-labelledby="overrides-label">
          <div className="override-row override-head" aria-hidden="true"><span>参与方</span><span>模型</span><span /></div>
          {entries.map(([datasetId, ref]) => {
            const dataset = selected.find((item) => item.id === datasetId);
            if (!dataset) return null;
            return (
              <div key={datasetId} className="override-row">
                <select
                  aria-label="参与方"
                  value={datasetId}
                  onChange={(event) => {
                    const next = { ...overrides };
                    delete next[datasetId];
                    set({ ...next, [event.target.value]: ref });
                  }}
                >
                  {[dataset, ...free].map((item) => <option key={item.id} value={item.id}>{nameOf(item)}</option>)}
                </select>
                <select aria-label={`${nameOf(dataset)} 使用的模型`} value={ref} onChange={(event) => set({ ...overrides, [datasetId]: event.target.value })}>
                  {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
                </select>
                <button
                  type="button"
                  className="button button--ghost"
                  aria-label={`移除 ${nameOf(dataset)} 的单独设置`}
                  onClick={() => {
                    const next = { ...overrides };
                    delete next[datasetId];
                    set(next);
                  }}
                >
                  移除
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      {free.length ? (
        <button type="button" className="button button--secondary button--compact" onClick={() => set({ ...overrides, [free[0].id]: draft.clientModel })}>
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

function modelSummary(draft: Draft, state: State): string {
  const client = modelLabel(draft.clientModel, state.endpoints);
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
