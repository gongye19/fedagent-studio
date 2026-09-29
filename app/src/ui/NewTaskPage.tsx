import { useEffect, useRef, useState, type Dispatch, type MouseEvent } from "react";
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
import { HOSTING_LABELS, modelLabel, modelOptions, PARTICIPANT_STATUS, usable, type Dataset } from "../domain/resources";
import { hrefOf, navigate } from "../state/route";
import { participantOf, type Action, type State } from "../state/store";
import { Collapsible, Notice, PageHead, Tag } from "./common";
import { Choices, Field, FieldGroup, Panel, UnitInput } from "./console";
import { formatDuration, formatNumber, formatTokens, formatYuan } from "./format";
import { Icon } from "./icons";

type Props = { state: State; dispatch: Dispatch<Action>; scenario?: ScenarioId };

const NARROW = "(max-width: 1180px)";

/**
 * 新建联邦任务：按云平台"创建实例"的方式，分区块配置，右侧是配置摘要和预估。
 * 场景、算法、任务类型、参数都来自注册表，页面不针对某个算法写死。
 */
export default function NewTaskPage({ state, dispatch, scenario }: Props) {
  const draft = state.draft;
  const applied = useRef<ScenarioId | undefined>(undefined);
  const named = useRef(false);
  const cardConfirm = useRef<HTMLButtonElement>(null);
  const barConfirm = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  // 打开页面时草稿里已经有内容：要么是上次没填完，要么是从任务"复制为新任务"带过来的。
  const [restored, setRestored] = useState<"copy" | "draft" | null>(() => (
    draft.scenario === null ? null : draft.name.endsWith("（副本）") ? "copy" : "draft"
  ));

  useEffect(() => {
    // 从别处带着场景进入时预先选好；只在地址里的场景变化时应用一次。
    if (!scenario || applied.current === scenario) return;
    applied.current = scenario;
    dispatch({ type: "chooseScenario", scenario });
  }, [scenario, dispatch]);

  useEffect(() => {
    // 只有一个场景可用时直接选上。
    if (scenario || draft.scenario) return;
    const available = SCENARIOS.filter((item) => item.status === "available");
    if (available.length === 1) dispatch({ type: "chooseScenario", scenario: available[0].id });
  }, [scenario, draft.scenario, dispatch]);

  useEffect(() => {
    // 选好算法后填一个默认名称；每次打开页面只填一次，用户清空后不再填回。
    if (!draft.algorithm || draft.name || named.current) return;
    named.current = true;
    dispatch({ type: "updateDraft", patch: { name: defaultTaskName({ algorithm: draft.algorithm }) } });
  }, [draft.algorithm, draft.name, dispatch]);

  useEffect(() => {
    // 确认框出现后把焦点交给"确认开始"：窄屏时它在底部栏里，宽屏时在配置摘要里。
    if (!confirming) return;
    (window.matchMedia(NARROW).matches ? barConfirm : cardConfirm).current?.focus();
  }, [confirming]);

  const update = (patch: Partial<Draft>) => dispatch({ type: "updateDraft", patch });
  const algorithm = draft.algorithm ? algorithmOf(draft.algorithm) : null;
  const candidates = algorithm ? compatibleDatasets(algorithm.id, state.datasets) : [];
  const selected = candidates.filter((dataset) => draft.datasetIds.includes(dataset.id) && usable(dataset, state.participants));
  const issues = draftIssues(draft, state.datasets, state.participants, state.endpoints);
  const config = toConfig(draft);
  const result = config && selected.length ? estimate(config, state.datasets, state.endpoints) : null;
  const full = draft.mode === "full";
  const samples = selected.reduce((sum, dataset) => sum + dataset.count, 0);
  const overrideCount = Object.keys(activeOverrides(draft)).length;

  function create() {
    if (issues.length) return;
    const id = `task-${Date.now().toString(36)}`;
    dispatch({ type: "createTask", id, createdAt: new Date().toISOString() });
    navigate({ page: "task", id, tab: "progress" });
  }

  function restart() {
    dispatch({ type: "resetDraft" });
    named.current = false;
    setConfirming(false);
    setRestored(null);
    if (scenario) {
      applied.current = scenario;
      dispatch({ type: "chooseScenario", scenario });
    }
  }

  /** 正式运行调用量大，先确认一次；试跑直接开始。 */
  function start() {
    if (issues.length) return;
    if (full && !confirming) {
      setConfirming(true);
      return;
    }
    create();
  }

  const showConfirm = confirming && full && result !== null && !issues.length;
  const startLabel = full ? "创建并正式运行" : "创建并试跑";

  return (
    <>
      <PageHead title="新建联邦任务" crumbs={[{ label: "联邦任务", route: { page: "tasks" } }]} />
      {restored && draft.scenario ? (
        <Notice action={<button type="button" className="link-button" onClick={restart}>清空重填</button>}>
          {restored === "copy" ? "已带入原任务的配置。" : "已恢复上次没填完的配置。"}
        </Notice>
      ) : null}

      <div className="order-layout">
        <div className="order-main">
          <Panel title="基本信息" id="basic">
            <div className="form-body">
              <FieldGroup>
                <Field label="任务名称" htmlFor="task-name">
                  <input id="task-name" name="task-name" autoComplete="off" value={draft.name} placeholder={defaultTaskName(draft)} maxLength={60} onChange={(event) => update({ name: event.target.value })} />
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
                {draft.scenario ? (
                  <Field label="算法" labelId="algorithm-label" wide>
                    <AlgorithmTable scenario={draft.scenario} value={draft.algorithm} onChange={(id) => dispatch({ type: "chooseAlgorithm", algorithm: id })} />
                  </Field>
                ) : null}
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
              extra={`已选 ${selected.length} 个 · ${formatNumber(samples)} 条样本`}
              actions={<a className="button button--secondary button--compact" href={hrefOf({ page: "participants" })}><Icon name="plus" />新增参与方</a>}
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
            {result ? <EstimateBlock result={result} /> : null}
            {showConfirm ? (
              <div className="summary-confirm" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-text">
                <strong id="confirm-title">开始正式运行？</strong>
                <p id="confirm-text">{result ? `参与方调用 ${formatNumber(result.participantCalls)} 次，${formatDuration(result.seconds)}；费用${result.cost === null ? "未知（没有设置单价）" : formatYuan(result.cost)}。` : ""}</p>
                <div className="summary-confirm-actions">
                  <button type="button" className="button button--secondary" onClick={() => setConfirming(false)}>取消</button>
                  <button ref={cardConfirm} type="button" className="button button--primary" onClick={create}>确认开始</button>
                </div>
              </div>
            ) : (
              <button type="button" className="button button--primary button--block" disabled={issues.length > 0} onClick={start}>{startLabel}</button>
            )}
            {issues.length ? <p className="summary-issues">还需要：{issues.map((issue) => issue.message).join("；")}</p> : null}
          </Panel>
        </aside>
      </div>

      {showConfirm ? (
        <div className="order-bar order-bar--confirm" role="alertdialog" aria-labelledby="bar-confirm-title" aria-describedby="bar-confirm-text">
          <div>
            <strong id="bar-confirm-title">开始正式运行？</strong>
            <small id="bar-confirm-text">{result ? `参与方调用 ${formatNumber(result.participantCalls)} 次 · ${formatDuration(result.seconds)}` : ""}</small>
          </div>
          <div className="order-bar-actions">
            <button type="button" className="button button--secondary" onClick={() => setConfirming(false)}>取消</button>
            <button ref={barConfirm} type="button" className="button button--primary" onClick={create}>确认开始</button>
          </div>
        </div>
      ) : (
        <div className="order-bar" aria-label="创建任务">
          <div>
            <strong>{issues.length ? `还需要：${issues[0].message}` : `${selected.length} 个参与方 · 约 ${formatNumber(result?.participantCalls ?? 0)} 次调用`}</strong>
            {result && !issues.length ? <small>{formatDuration(result.seconds)}</small> : null}
          </div>
          <button type="button" className="button button--primary" disabled={issues.length > 0} onClick={start}>{startLabel}</button>
        </div>
      )}
    </>
  );
}

/** 算法：带单选的表格，列出这个场景下登记的算法，比较它们交换什么、产出什么。 */
function AlgorithmTable({ scenario, value, onChange }: { scenario: ScenarioId; value: Draft["algorithm"]; onChange: (id: Algorithm["id"]) => void }) {
  const algorithms = algorithmsFor(scenario);
  if (!algorithms.length) return <p className="field-static">这个场景的算法待接入。</p>;
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

/** 参与方与数据：带复选框的表格，表头可以全选。 */
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
          {candidates.map((dataset) => {
            const owner = participantOf(state, dataset.participantId);
            const enabled = usable(dataset, state.participants);
            const checked = enabled && chosen.has(dataset.id);
            const toggle = () => dispatch({ type: "toggleDataset", datasetId: dataset.id });
            const inputId = `pick-${dataset.id}`;
            return (
              <tr key={dataset.id} className={`select-row${checked ? " select-row--checked" : ""}${enabled ? "" : " select-row--disabled"}`} onClick={rowToggle(enabled, toggle)}>
                <td className="select-cell"><input id={inputId} type="checkbox" checked={checked} disabled={!enabled} onChange={toggle} /></td>
                <th scope="row"><label htmlFor={inputId}>{owner?.name ?? dataset.name}</label></th>
                <td className="col-optional">{dataset.description}</td>
                <td className="numeric">{formatNumber(dataset.count)}</td>
                <td className="col-optional">{owner ? HOSTING_LABELS[owner.hosting] : "—"}</td>
                <td>{owner && owner.status !== "online" ? <Tag tone="warning">{PARTICIPANT_STATUS[owner.status]}</Tag> : <span className="status-text">可用</span>}</td>
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
                  <a className="text-link" href={hrefOf({ page: "participants", id: participant.id })}>去连接</a>
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
        <Field label="轮次" labelId="rounds-label" wide>
          <Choices labelledBy="rounds-label" value={draft.rounds} options={rounds.map((value) => ({ value, label: `${value} 轮` }))} onChange={(value) => update({ rounds: value })} />
        </Field>
        <Field label="参与方模型" htmlFor="client-model">
          <select id="client-model" name="client-model" value={draft.clientModel} onChange={(event) => update({ clientModel: event.target.value })}>
            {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="服务端模型" htmlFor="server-model">
          <select id="server-model" name="server-model" value={draft.serverModel} onChange={(event) => update({ serverModel: event.target.value })}>
            {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
          </select>
        </Field>
      </FieldGroup>
    </div>
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
          <Field label="并发数" htmlFor="workers">
            <input id="workers" name="workers" type="number" inputMode="numeric" autoComplete="off" min={1} max={64} value={draft.workers} onChange={(event) => update({ workers: clampInt(event.target.value, 1, 64, draft.workers) })} />
          </Field>
          <Field label="随机种子" htmlFor="seed">
            <input id="seed" name="seed" type="number" inputMode="numeric" autoComplete="off" min={0} value={draft.seed} onChange={(event) => update({ seed: clampInt(event.target.value, 0, 1_000_000, draft.seed) })} />
          </Field>
          <Field label="单独指定模型" labelId="overrides-label" wide>
            <ModelOverrides state={state} draft={draft} update={update} selected={selected} />
          </Field>
        </FieldGroup>
      </div>
    </Collapsible>
  );
}

/** 按注册表里的参数定义生成一个字段：下拉或数字输入。 */
function ParamField({ def, draft, update }: { def: ParamDef; draft: Draft; update: (patch: Partial<Draft>) => void }) {
  const id = `param-${def.key}`;
  if (def.kind === "number") {
    const value = draft[def.key];
    return (
      <Field label={def.label} htmlFor={id}>
        <UnitInput id={id} unit={def.unit} name={def.key} type="number" inputMode="numeric" autoComplete="off" min={def.min} max={def.max} value={value} onChange={(event) => update({ [def.key]: clampInt(event.target.value, def.min, def.max, value) })} />
      </Field>
    );
  }
  if (def.kind === "select-number") {
    const value = draft[def.key];
    return (
      <Field label={def.label} htmlFor={id}>
        <select id={id} name={def.key} value={value ?? ""} onChange={(event) => update({ [def.key]: event.target.value ? Number(event.target.value) : null })}>
          {def.options.map((option) => <option key={String(option.value)} value={option.value ?? ""}>{option.label}</option>)}
        </select>
      </Field>
    );
  }
  return (
    <Field label={def.label} htmlFor={id}>
      <select id={id} name={def.key} value={draft[def.key]} onChange={(event) => update({ [def.key]: event.target.value } as Partial<Draft>)}>
        {def.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </Field>
  );
}

/** 默认所有参与方用同一个模型；需要时逐条添加例外。 */
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
        <ul className="override-list" aria-labelledby="overrides-label">
          {entries.map(([datasetId, ref]) => {
            const dataset = selected.find((item) => item.id === datasetId);
            if (!dataset) return null;
            return (
              <li key={datasetId}>
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
                <div className="override-model">
                  <select aria-label={`${nameOf(dataset)} 使用的模型`} value={ref} onChange={(event) => set({ ...overrides, [datasetId]: event.target.value })}>
                    {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
                  </select>
                  <button
                    type="button"
                    className="button button--ghost button--compact"
                    onClick={() => {
                      const next = { ...overrides };
                      delete next[datasetId];
                      set(next);
                    }}
                  >
                    移除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
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

function EstimateBlock({ result }: { result: Estimate }) {
  return (
    <div className="summary-estimate">
      <h3>预估</h3>
      <dl className="summary-list">
        <div><dt>参与方调用</dt><dd>{formatNumber(result.participantCalls)} 次</dd></div>
        <div><dt>服务端调用</dt><dd>至少 {result.serverCalls} 次</dd></div>
        <div><dt>token</dt><dd>约 {formatTokens(result.participantTokens + result.serverTokens)}</dd></div>
        <div><dt>时长</dt><dd>{formatDuration(result.seconds)}</dd></div>
        <div><dt>费用</dt><dd>{result.cost === null ? <a className="text-link" href={hrefOf({ page: "models" })}>未设置单价</a> : formatYuan(result.cost)}</dd></div>
      </dl>
    </div>
  );
}
