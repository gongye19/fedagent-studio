import { useEffect, useRef, useState, type Dispatch, type MouseEvent } from "react";
import { algorithmOf, algorithmsFor, GRADERS, SCENARIOS, scenarioOf, TASK_TYPES, type Algorithm, type ScenarioId } from "../domain/catalog";
import {
  activeOverrides,
  compatibleDatasets,
  DEFAULT_DRAFT,
  defaultTaskName,
  draftIssues,
  estimate,
  ESTIMATE_BASIS,
  INSIGHT_TARGETS,
  toConfig,
  TRACE_DENSITIES,
  type Draft,
  type Estimate,
  type RunMode,
} from "../domain/config";
import { HOSTING_LABELS, modelLabel, modelOptions, PARTICIPANT_STATUS, usable, type Dataset, type Participant } from "../domain/resources";
import { hrefOf, navigate } from "../state/route";
import { participantOf, type Action, type State } from "../state/store";
import { Collapsible, PageHead, Section, Tag } from "./common";
import { formatDuration, formatNumber, formatTokens, formatYuan } from "./format";
import { Icon } from "./icons";
import { OptionCard } from "./OptionCard";

type Props = { state: State; dispatch: Dispatch<Action>; scenario?: ScenarioId };

export default function NewTaskPage({ state, dispatch, scenario }: Props) {
  const draft = state.draft;
  const applied = useRef<ScenarioId | undefined>(undefined);
  const named = useRef(false);
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
    // 选好算法后填一个默认名称，作为输入框的真实值；每次打开页面只填一次，用户清空后不再填回。
    if (!draft.algorithm || draft.name || named.current) return;
    named.current = true;
    dispatch({ type: "updateDraft", patch: { name: defaultTaskName({ algorithm: draft.algorithm }) } });
  }, [draft.algorithm, draft.name, dispatch]);

  const update = (patch: Partial<Draft>) => dispatch({ type: "updateDraft", patch });
  const algorithm = draft.algorithm ? algorithmOf(draft.algorithm) : null;
  const candidates = algorithm ? compatibleDatasets(algorithm.id, state.datasets) : [];
  const selected = candidates.filter((dataset) => draft.datasetIds.includes(dataset.id) && usable(dataset, state.participants));
  const issues = draftIssues(draft, state.datasets, state.participants, state.endpoints);
  const config = toConfig(draft);
  const result = config && selected.length ? estimate(config, state.datasets, state.endpoints) : null;
  const full = draft.mode === "full";

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
      document.getElementById("task-summary")?.scrollIntoView({ block: "nearest" });
      return;
    }
    create();
  }

  return (
    <>
      <PageHead title="新建联邦任务" crumbs={[{ label: "联邦任务", route: { page: "tasks" } }]} />
      {restored && draft.scenario ? (
        <div className="notice" role="status">
          <span>{restored === "copy" ? "已带入原任务的配置，改好后再开始。" : "已恢复上次没填完的配置。"}</span>
          <button type="button" className="button button--ghost button--compact" onClick={restart}>重新开始</button>
        </div>
      ) : null}
      <div className="order-layout">
        <div className="order-main">
          <Section title="场景" id="scenario">
            <ScenarioCards draft={draft} dispatch={dispatch} />
          </Section>

          {draft.scenario && algorithmsFor(draft.scenario).length ? (
            <Section title="算法" id="algorithm">
              <AlgorithmPicker draft={draft} dispatch={dispatch} />
            </Section>
          ) : null}

          {algorithm ? (
            <Section
              title="数据"
              id="data"
              meta={`一份数据代表一个参与方，至少选 ${algorithm.minParticipants} 份。`}
              actions={(
                <>
                  <span className="section-count">已选 {selected.length} 份 · {formatNumber(selected.reduce((sum, dataset) => sum + dataset.count, 0))} 题</span>
                  <a className="button button--secondary button--compact" href={hrefOf({ page: "participants" })}><Icon name="plus" />新增参与方</a>
                </>
              )}
            >
              <DataTable state={state} dispatch={dispatch} candidates={candidates} selected={selected} />
            </Section>
          ) : null}

          {algorithm && selected.length ? (
            <Section title="运行设置" id="settings">
              <RunSettings state={state} draft={draft} update={update} algorithm={algorithm} selected={selected} />
            </Section>
          ) : null}
        </div>

        <aside className="order-summary" aria-label="任务配置" id="task-summary">
          <div className="card summary-card">
            <label className="field">
              <span>任务名称</span>
              <input value={draft.name} placeholder={defaultTaskName(draft)} maxLength={60} onChange={(event) => update({ name: event.target.value })} />
            </label>
            <dl className="summary-list">
              <div><dt>场景与算法</dt><dd>{draft.scenario ? `${scenarioOf(draft.scenario).name.replace(" Agent", "")}${algorithm ? ` · ${algorithm.name}` : ""}` : "未选择"}</dd></div>
              <div>
                <dt>参与方</dt>
                <dd>
                  {selected.length ? `${selected.length} 方 · ${formatNumber(result?.problems ?? 0)} 题` : "—"}
                  {selected.length ? <small>{memberNames(selected, state)}</small> : null}
                </dd>
              </div>
              {algorithm ? (
                <>
                  <div><dt>运行</dt><dd>{full ? "正式运行" : `试跑 · 每份前 ${draft.trialCap} 题`} · {draft.rounds} 轮</dd></div>
                  <div><dt>模型</dt><dd>{modelSummary(draft, state)}</dd></div>
                </>
              ) : null}
            </dl>
            {result ? <EstimateBlock result={result} /> : null}

            {confirming && full && result && !issues.length ? (
              <div className="summary-confirm" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-text">
                <strong id="confirm-title">开始正式运行？</strong>
                <p id="confirm-text">
                  {`将调用模型约 ${formatNumber(result.participantCalls + result.serverCalls)} 次，token 约 ${formatTokens(result.participantTokens + result.serverTokens)}，预计${formatDuration(result.seconds)}；费用${result.cost === null ? "未知（没有设置单价）" : formatYuan(result.cost)}。`}
                </p>
                <div className="summary-confirm-actions">
                  <button type="button" className="button button--secondary" onClick={() => setConfirming(false)}>取消</button>
                  <button type="button" className="button button--primary" onClick={create}>确认开始</button>
                </div>
              </div>
            ) : (
              <>
                {full && result ? <p className="summary-warning">正式运行调用量大，建议先试跑。</p> : null}
                <button type="button" className="button button--primary button--block" disabled={issues.length > 0} onClick={start}>
                  {full ? "开始正式运行" : "开始试跑"}
                </button>
              </>
            )}
            {issues.length ? <p className="summary-issues">还需要：{issues.map((issue) => issue.message).join("；")}</p> : null}
          </div>
        </aside>
      </div>

      <div className="order-bar" aria-label="创建任务">
        <div>
          <strong>{selected.length ? `${selected.length} 方 · ${formatNumber(result?.participantCalls ?? 0)} 次调用` : "未选数据"}</strong>
          <small>{issues[0]?.message ?? (result ? `预计${formatDuration(result.seconds)}` : "")}</small>
        </div>
        <button type="button" className="button button--primary" disabled={issues.length > 0} onClick={start}>
          {full ? "正式运行" : "开始试跑"}
        </button>
      </div>
    </>
  );
}

function ScenarioCards({ draft, dispatch }: { draft: Draft; dispatch: Dispatch<Action> }) {
  return (
    <div className="option-grid" role="radiogroup" aria-labelledby="scenario-title">
      {SCENARIOS.map((item) => {
        const planned = item.status === "planned";
        return (
          <OptionCard
            key={item.id}
            name="scenario"
            checked={draft.scenario === item.id}
            disabled={planned}
            onChange={() => dispatch({ type: "chooseScenario", scenario: item.id })}
            title={item.name}
            aside={planned ? <Tag>规划中</Tag> : undefined}
            foot={`数据：${item.dataNeeds}`}
          >
            {item.summary}
          </OptionCard>
        );
      })}
    </div>
  );
}

/**
 * 算法：只有一个可用算法时不需要"选"，直接显示它是什么、每轮怎么运行；
 * 有多个算法时才用选项卡片，选中的算法在下方展开说明。
 */
function AlgorithmPicker({ draft, dispatch }: { draft: Draft; dispatch: Dispatch<Action> }) {
  if (!draft.scenario) return null;
  const algorithms = algorithmsFor(draft.scenario);
  const chosen = draft.algorithm ? algorithmOf(draft.algorithm) : null;
  return (
    <div className="stack">
      {algorithms.length > 1 ? (
        <div className="option-grid" role="radiogroup" aria-labelledby="algorithm-title">
          {algorithms.map((item) => (
            <OptionCard
              key={item.id}
              name="algorithm"
              checked={draft.algorithm === item.id}
              onChange={() => dispatch({ type: "chooseAlgorithm", algorithm: item.id })}
              title={<>{item.name}<small>{item.fullName}</small></>}
              foot={item.highlights.join(" · ")}
            >
              {item.summary}
            </OptionCard>
          ))}
        </div>
      ) : null}
      {chosen ? (
        <Collapsible
          title={`${chosen.name} · ${chosen.fullName}`}
          sub={`${chosen.summary}${chosen.highlights.join("，")}。展开看每一轮的 ${chosen.stages.length} 步。`}
        >
          <AlgorithmFlow algorithm={chosen} />
        </Collapsible>
      ) : null}
    </div>
  );
}

function AlgorithmFlow({ algorithm }: { algorithm: Algorithm }) {
  const participantSteps = algorithm.stages.filter((stage) => stage.side === "participant");
  const serverSteps = algorithm.stages.filter((stage) => stage.side === "server");
  const column = (title: string, steps: typeof participantSteps, offset: number, foot: string) => (
    <div className="flow-column">
      <h3>{title}</h3>
      <ol className="flow-steps">
        {steps.map((stage, index) => (
          <li key={stage.id}>
            <span className="flow-index" aria-hidden="true">{offset + index + 1}</span>
            <div><strong>{stage.label}</strong><small>{stage.detail}</small></div>
          </li>
        ))}
      </ol>
      <p className="flow-foot">{foot}</p>
    </div>
  );
  return (
    <div className="algorithm-flow">
      <div className="flow-columns">
        {column("参与方（各自运行）", participantSteps, 0, `留在本方：${algorithm.keeps}`)}
        <div className="flow-arrow" aria-hidden="true"><span>只上传 trace</span><Icon name="arrow" /></div>
        {column("服务端", serverSteps, participantSteps.length, "洞见库下发给所有参与方，进入下一轮")}
      </div>
      <dl className="facts facts--compact">
        <div><dt>适用数据</dt><dd>{algorithm.accepts.map((type) => TASK_TYPES[type].label).join("、")}；{algorithm.answersRequired ? "需要标准答案" : "标准答案可缺省，只用于评分"}</dd></div>
        <div><dt>评分方式</dt><dd>{algorithm.accepts.map((type) => GRADERS[TASK_TYPES[type].grader].detail).join("；")}</dd></div>
        <div>
          <dt>来源</dt>
          <dd>
            <a className="text-link" href={algorithm.source.paperUrl} target="_blank" rel="noreferrer">论文 {algorithm.source.paper}</a>
            {" · "}
            <a className="text-link" href={algorithm.source.codeUrl} target="_blank" rel="noreferrer">代码 {algorithm.source.code}</a>
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** 只标例外：参与方本地、离线、没有答案或只有部分答案。 */
function exceptions(dataset: Dataset, owner: Participant | undefined): { label: string; warning: boolean }[] {
  const tags: { label: string; warning: boolean }[] = [];
  if (owner && owner.hosting !== "platform") tags.push({ label: HOSTING_LABELS[owner.hosting], warning: false });
  if (owner && owner.status !== "online") tags.push({ label: PARTICIPANT_STATUS[owner.status], warning: true });
  if (dataset.answered === 0) tags.push({ label: "无答案", warning: false });
  else if (dataset.answered < dataset.count) tags.push({ label: `${dataset.answered} 题带答案`, warning: false });
  return tags;
}

/** 点行里任意位置都能勾选；点到复选框和它的标签时交给浏览器处理，避免切换两次。 */
function rowToggle(enabled: boolean, toggle: () => void) {
  return (event: MouseEvent<HTMLTableRowElement>) => {
    if (!enabled || (event.target as HTMLElement).closest("input, label, a, button")) return;
    toggle();
  };
}

/** 多选参与方的数据：带复选框的表格，按"添加的参与方 / 内置示例"分组，和"参与方与数据"页一致。 */
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
  const isBuiltin = (dataset: Dataset) => Boolean(participantOf(state, dataset.participantId)?.builtin);
  const builtin = candidates.filter(isBuiltin);
  const plain = builtin.every((dataset) => exceptions(dataset, participantOf(state, dataset.participantId)).length === 0);
  const groups = [
    { key: "added", title: "添加的参与方", note: null, rows: candidates.filter((dataset) => !isBuiltin(dataset)), waiting },
    { key: "builtin", title: "内置示例", note: plain ? "平台托管，都带标准答案" : null, rows: builtin, waiting: [] },
  ].filter((group) => group.rows.length || group.waiting.length);

  return (
    <div className="table-shell">
      <table className="table table--select">
        <caption className="visually-hidden">选择参加任务的数据，每份代表一个参与方</caption>
        <thead>
          <tr>
            <th scope="col" className="select-cell">
              <input
                ref={head}
                type="checkbox"
                aria-label="全选"
                checked={all}
                disabled={!usableIds.length}
                onChange={() => dispatch({ type: "setDatasets", datasetIds: all ? [] : usableIds })}
              />
            </th>
            <th scope="col">参与方与数据</th>
            <th scope="col" className="numeric">题数</th>
            <th scope="col" className="col-optional">来源</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key}>
            <tr className="group-row">
              <th scope="colgroup" colSpan={4}>{group.title} · {group.rows.length + group.waiting.length}{group.note ? <span>{group.note}</span> : null}</th>
            </tr>
            {group.rows.map((dataset) => {
              const owner = participantOf(state, dataset.participantId);
              const enabled = usable(dataset, state.participants);
              const checked = enabled && chosen.has(dataset.id);
              const toggle = () => dispatch({ type: "toggleDataset", datasetId: dataset.id });
              const inputId = `pick-${dataset.id}`;
              return (
                <tr key={dataset.id} className={`select-row${enabled ? "" : " select-row--disabled"}`} onClick={rowToggle(enabled, toggle)}>
                  <td className="select-cell">
                    <input id={inputId} type="checkbox" checked={checked} disabled={!enabled} onChange={toggle} />
                  </td>
                  <th scope="row">
                    <span className="cell-title">
                      <label htmlFor={inputId}>{dataset.name}</label>
                      <span className="cell-note">{owner && owner.name !== dataset.name ? `${owner.name} · ${dataset.description}` : dataset.description}</span>
                      {exceptions(dataset, owner).map((tag) => <Tag key={tag.label} tone={tag.warning ? "warning" : "neutral"}>{tag.label}</Tag>)}
                    </span>
                  </th>
                  <td className="numeric">{formatNumber(dataset.count)}</td>
                  <td className="col-optional nowrap">{dataset.origin ?? (dataset.source === "upload" ? "上传" : "—")}</td>
                </tr>
              );
            })}
            {group.waiting.map((participant) => (
              <tr key={participant.id} className="select-row select-row--disabled">
                <td className="select-cell">
                  <input type="checkbox" disabled aria-label={`${participant.name}（${PARTICIPANT_STATUS[participant.status]}，暂不能选）`} />
                </td>
                <th scope="row">
                  <span className="cell-title">
                    {participant.name}
                    <Tag>{HOSTING_LABELS[participant.hosting]}</Tag>
                    <Tag tone="warning">{PARTICIPANT_STATUS[participant.status]}</Tag>
                    <a className="text-link" href={hrefOf({ page: "participants", id: participant.id })}>去连接</a>
                  </span>
                </th>
                <td className="numeric">—</td>
                <td className="col-optional">—</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

const MODES: readonly { id: RunMode; label: string }[] = [
  { id: "trial", label: "试跑" },
  { id: "full", label: "正式运行" },
];

function RunSettings({
  state, draft, update, algorithm, selected,
}: {
  state: State;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  algorithm: Algorithm;
  selected: Dataset[];
}) {
  const options = modelOptions(state.endpoints);
  const total = selected.reduce((sum, dataset) => sum + dataset.count, 0);
  const rounds = Array.from({ length: algorithm.maxRounds - algorithm.minRounds + 1 }, (_, index) => algorithm.minRounds + index);
  const changed = advancedChanges(draft);
  const insight = INSIGHT_TARGETS.find((item) => item.id === draft.insightTarget);
  const density = TRACE_DENSITIES.find((item) => item.id === draft.traceDensity);

  /** 两种运行方式各自的调用量和时长，直接写在卡片上，方便比较。 */
  function preview(mode: RunMode): string {
    const config = toConfig({ ...draft, mode });
    if (!config) return "";
    const result = estimate(config, state.datasets, state.endpoints);
    return `约 ${formatNumber(result.participantCalls)} 次调用 · ${formatDuration(result.seconds)}`;
  }

  return (
    <div className="stack">
      <div className="option-grid" role="radiogroup" aria-label="运行方式">
        {MODES.map((mode) => (
          <OptionCard key={mode.id} name="mode" checked={draft.mode === mode.id} onChange={() => update({ mode: mode.id })} title={mode.label} foot={preview(mode.id)}>
            {mode.id === "trial" ? `每份只取前 ${draft.trialCap} 题，先确认流程和费用` : `使用全部 ${formatNumber(total)} 题`}
          </OptionCard>
        ))}
      </div>

      <div className="form-grid">
        <label className="field">
          <span>轮次</span>
          <select value={draft.rounds} onChange={(event) => update({ rounds: Number(event.target.value) })}>
            {rounds.map((value) => <option key={value} value={value}>{value} 轮</option>)}
          </select>
        </label>
        {draft.mode === "trial" ? (
          <label className="field">
            <span>试跑题数（每份）</span>
            <input type="number" min={1} max={50} value={draft.trialCap} onChange={(event) => update({ trialCap: clampInt(event.target.value, 1, 50, draft.trialCap) })} />
          </label>
        ) : null}
        <label className="field field--row-start">
          <span>参与方模型</span>
          <select value={draft.clientModel} onChange={(event) => update({ clientModel: event.target.value })}>
            {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>服务端模型（需长上下文）</span>
          <select value={draft.serverModel} onChange={(event) => update({ serverModel: event.target.value })}>
            {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
          </select>
        </label>
      </div>

      <Collapsible
        title={<>高级设置{changed ? <Tag tone="info">已改 {changed} 项</Tag> : null}</>}
        sub="洞见库条数、trace 密度、重试、种子、并发，以及为个别参与方指定模型"
      >
        <div className="form-grid">
          <label className="field">
            <span>洞见库条数</span>
            <select value={draft.insightTarget} onChange={(event) => update({ insightTarget: event.target.value as Draft["insightTarget"] })}>
              {INSIGHT_TARGETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            {insight ? <small className="field-hint">{insight.hint}</small> : null}
          </label>
          <label className="field">
            <span>trace 密度</span>
            <select value={draft.traceDensity} onChange={(event) => update({ traceDensity: event.target.value as Draft["traceDensity"] })}>
              {TRACE_DENSITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            {density ? <small className="field-hint">{density.hint}</small> : null}
          </label>
          <label className="field">
            <span>每题最多 trace 数</span>
            <select value={draft.maxTracesPerItem ?? ""} onChange={(event) => update({ maxTracesPerItem: event.target.value ? Number(event.target.value) : null })}>
              <option value="">不限（论文设置）</option>
              {[1, 2, 3].map((value) => <option key={value} value={value}>{value} 条</option>)}
            </select>
          </label>
          <label className="field">
            <span>汇总重试上限</span>
            <input type="number" min={1} max={20} value={draft.aggregationRetries} onChange={(event) => update({ aggregationRetries: clampInt(event.target.value, 1, 20, draft.aggregationRetries) })} />
            <small className="field-hint">超过后暂停任务，避免费用失控</small>
          </label>
          <label className="field">
            <span>随机种子</span>
            <input type="number" min={0} value={draft.seed} onChange={(event) => update({ seed: clampInt(event.target.value, 0, 1_000_000, draft.seed) })} />
          </label>
          <label className="field">
            <span>并发数</span>
            <input type="number" min={1} max={64} value={draft.workers} onChange={(event) => update({ workers: clampInt(event.target.value, 1, 64, draft.workers) })} />
            <small className="field-hint">所有参与方共用</small>
          </label>
          <ModelOverrides state={state} draft={draft} update={update} selected={selected} />
        </div>
      </Collapsible>
    </div>
  );
}

/** 默认所有参与方用同一个模型；需要时逐条添加例外，而不是给每个参与方都摆一个下拉框。 */
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

  return (
    <div className="field field--wide">
      <span id="overrides-label">为个别参与方指定模型</span>
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
              </li>
            );
          })}
        </ul>
      ) : (
        <small className="field-hint">目前所有参与方都用上面的参与方模型。</small>
      )}
      {free.length ? (
        <button type="button" className="button button--secondary button--compact field-action" onClick={() => set({ ...overrides, [free[0].id]: draft.clientModel })}>
          <Icon name="plus" />添加
        </button>
      ) : null}
    </div>
  );
}

const ADVANCED_KEYS = ["insightTarget", "traceDensity", "maxTracesPerItem", "aggregationRetries", "seed", "workers"] as const;

/** 高级设置里和默认值不同的项数；单独指定模型的参与方每个算一项。 */
function advancedChanges(draft: Draft): number {
  return ADVANCED_KEYS.filter((key) => draft[key] !== DEFAULT_DRAFT[key]).length + Object.keys(activeOverrides(draft)).length;
}

/** 配置清单里列出前几个参与方的名称。 */
function memberNames(selected: Dataset[], state: State): string {
  const names = selected.map((dataset) => participantOf(state, dataset.participantId)?.name ?? dataset.name);
  return names.length > 3 ? `${names.slice(0, 3).join("、")} 等 ${names.length} 方` : names.join("、");
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function modelSummary(draft: Draft, state: State): string {
  const client = modelLabel(draft.clientModel, state.endpoints);
  const server = modelLabel(draft.serverModel, state.endpoints);
  const count = Object.keys(activeOverrides(draft)).length;
  const base = client === server ? client : `参与方 ${client}；服务端 ${server}`;
  return count ? `${base}（${count} 方单独指定）` : base;
}

function EstimateBlock({ result }: { result: Estimate }) {
  const basis = ESTIMATE_BASIS;
  return (
    <div className="summary-estimate">
      <h3>预估</h3>
      <dl className="summary-list">
        <div><dt>模型调用</dt><dd>{formatNumber(result.participantCalls)} 次<small>服务端另至少 {result.serverCalls} 次</small></dd></div>
        <div><dt>token</dt><dd>约 {formatTokens(result.participantTokens + result.serverTokens)}</dd></div>
        <div><dt>时长</dt><dd>{formatDuration(result.seconds)}</dd></div>
        <div><dt>费用</dt><dd>{result.cost === null ? <a className="text-link" href={hrefOf({ page: "models" })}>未设置单价</a> : formatYuan(result.cost)}</dd></div>
      </dl>
      <Collapsible card={false} title="估算口径">
        <p>
          每题每轮：解题约 {formatNumber(basis.tokensPerCall.solve)}、反思约 {formatNumber(basis.tokensPerCall.reflect)}、提取约 {formatNumber(basis.tokensPerCall.extract)} token；
          平均耗时解题 {basis.secondsPerCall.solve} 秒、反思 {basis.secondsPerCall.reflect} 秒、提取 {basis.secondsPerCall.extract} 秒，服务端每次 {basis.secondsPerServerCall} 秒。首次真实运行后按实测值校准。
        </p>
      </Collapsible>
    </div>
  );
}
