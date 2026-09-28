import { useEffect, useRef, type Dispatch, type ReactNode } from "react";
import { algorithmOf, algorithmsFor, GRADERS, SCENARIOS, scenarioOf, TASK_TYPES, type Algorithm, type ScenarioId } from "../domain/catalog";
import {
  activeOverrides,
  compatibleDatasets,
  defaultTaskName,
  draftIssues,
  estimate,
  ESTIMATE_BASIS,
  INSIGHT_TARGETS,
  problemsOf,
  toConfig,
  TRACE_DENSITIES,
  type Draft,
  type Estimate,
} from "../domain/config";
import { HOSTING_LABELS, modelLabel, modelOptions, PARTICIPANT_STATUS, usable, type Dataset } from "../domain/resources";
import { hrefOf, navigate } from "../state/route";
import { participantOf, type Action, type State } from "../state/store";
import { PageHead, StatusPill } from "./common";
import { formatDuration, formatNumber, formatTokens, formatYuan } from "./format";

type Props = { state: State; dispatch: Dispatch<Action>; scenario?: ScenarioId };

export default function NewTaskPage({ state, dispatch, scenario }: Props) {
  const draft = state.draft;
  const applied = useRef<ScenarioId | undefined>(undefined);
  useEffect(() => {
    // 从总览的场景卡片进入时预先选好场景；只在地址里的场景变化时应用一次。
    if (!scenario || applied.current === scenario) return;
    applied.current = scenario;
    dispatch({ type: "chooseScenario", scenario });
  }, [scenario, dispatch]);

  const update = (patch: Partial<Draft>) => dispatch({ type: "updateDraft", patch });
  const algorithm = draft.algorithm ? algorithmOf(draft.algorithm) : null;
  const candidates = algorithm ? compatibleDatasets(algorithm.id, state.datasets) : [];
  const selected = candidates.filter((dataset) => draft.datasetIds.includes(dataset.id) && usable(dataset, state.participants));
  const issues = draftIssues(draft, state.datasets, state.participants, state.endpoints);
  const config = toConfig(draft);
  const result = config && selected.length ? estimate(config, state.datasets, state.endpoints) : null;

  function create() {
    if (issues.length) return;
    const id = `task-${Date.now().toString(36)}`;
    dispatch({ type: "createTask", id, createdAt: new Date().toISOString() });
    navigate({ page: "task", id, tab: "progress" });
  }

  return (
    <>
      <PageHead title="新建联邦任务" crumbs={[{ label: "联邦任务", route: { page: "tasks" } }]} />
      <div className="order-layout">
        <div className="order-main">
          <OrderSection index={1} id="scenario" title="场景">
            <div className="choice-grid" role="radiogroup" aria-label="场景">
              {SCENARIOS.map((item) => (
                <label key={item.id} className={`choice-card${draft.scenario === item.id ? " choice-card--checked" : ""}${item.status === "planned" ? " choice-card--planned" : ""}`}>
                  <input type="radio" name="scenario" checked={draft.scenario === item.id} onChange={() => dispatch({ type: "chooseScenario", scenario: item.id })} />
                  <span className="choice-top">
                    <strong>{item.name}</strong>
                    <StatusPill tone={item.status === "available" ? "success" : "neutral"}>{item.status === "available" ? "可用" : "规划中"}</StatusPill>
                  </span>
                  <span className="choice-text">{item.summary}</span>
                </label>
              ))}
            </div>
          </OrderSection>

          {draft.scenario ? (
            <OrderSection index={2} id="algorithm" title="算法">
              <AlgorithmChoices draft={draft} dispatch={dispatch} />
            </OrderSection>
          ) : null}

          {algorithm ? (
            <OrderSection index={3} id="data" title="数据">
              <DataChoices state={state} dispatch={dispatch} algorithm={algorithm} candidates={candidates} selected={selected} />
            </OrderSection>
          ) : null}

          {algorithm && selected.length ? (
            <OrderSection index={4} id="settings" title="运行设置">
              <RunSettings state={state} draft={draft} update={update} algorithm={algorithm} selected={selected} />
            </OrderSection>
          ) : null}
        </div>

        <aside className="order-summary" aria-label="任务配置">
          <div className="summary-card">
            <h2>任务配置</h2>
            <label className="field">
              <span>任务名称</span>
              <input value={draft.name} placeholder={defaultTaskName(draft)} maxLength={60} onChange={(event) => update({ name: event.target.value })} />
            </label>
            <dl className="summary-list">
              <div><dt>场景</dt><dd>{draft.scenario ? scenarioOf(draft.scenario).name : "未选择"}</dd></div>
              <div><dt>算法</dt><dd>{algorithm ? `${algorithm.name} · ${algorithm.fullName}` : "—"}</dd></div>
              <div><dt>参与方</dt><dd>{selected.length ? `${selected.length} 方 · ${formatNumber(result?.problems ?? 0)} 题` : "—"}</dd></div>
              {algorithm ? (
                <>
                  <div><dt>轮次</dt><dd>{draft.rounds} 轮</dd></div>
                  <div><dt>运行方式</dt><dd>{draft.mode === "trial" ? `试跑 · 每份前 ${draft.trialCap} 题` : "正式运行 · 全部题目"}</dd></div>
                  <div><dt>参与方模型</dt><dd>{clientModelSummary(draft, state)}</dd></div>
                  <div><dt>服务端模型</dt><dd>{modelLabel(draft.serverModel, state.endpoints)}</dd></div>
                </>
              ) : null}
            </dl>
            {result ? <EstimateBlock result={result} draft={draft} /> : null}
            <button type="button" className="button button--primary button--block" disabled={issues.length > 0} onClick={create}>
              {draft.mode === "trial" ? "创建并开始试跑" : "创建并开始运行"}
            </button>
            {issues.length ? <p className="summary-issues">还需要：{issues.map((issue) => issue.message).join("；")}</p> : null}
          </div>
        </aside>
      </div>

      <div className="order-bar" aria-label="创建任务">
        <div>
          <strong>{selected.length ? `${selected.length} 方 · ${formatNumber(result?.participantCalls ?? 0)} 次调用` : "未选数据"}</strong>
          <small>{issues[0]?.message ?? (result ? `预计${formatDuration(result.seconds)}` : "")}</small>
        </div>
        <button type="button" className="button button--primary" disabled={issues.length > 0} onClick={create}>创建</button>
      </div>
    </>
  );
}

function OrderSection({ index, id, title, children }: { index: number; id: string; title: string; children: ReactNode }) {
  return (
    <section className="order-section" id={id} aria-labelledby={`${id}-title`}>
      <header className="order-section-head">
        <span className="order-step" aria-hidden="true">{index}</span>
        <h2 id={`${id}-title`}>{title}</h2>
      </header>
      <div className="order-section-body">{children}</div>
    </section>
  );
}

function AlgorithmChoices({ draft, dispatch }: { draft: Draft; dispatch: Dispatch<Action> }) {
  if (!draft.scenario) return null;
  const scenario = scenarioOf(draft.scenario);
  const algorithms = algorithmsFor(scenario.id);
  if (scenario.status === "planned" || !algorithms.length) {
    return (
      <div className="planned-block">
        <strong>{scenario.name}的算法还在规划中</strong>
        <p>接入后会出现在这里。这个场景需要{scenario.dataNeeds}，例如{scenario.example}。</p>
      </div>
    );
  }
  const chosen = draft.algorithm ? algorithmOf(draft.algorithm) : null;
  return (
    <>
      <div className="choice-grid" role="radiogroup" aria-label="算法">
        {algorithms.map((item) => (
          <label key={item.id} className={`choice-card choice-card--wide${draft.algorithm === item.id ? " choice-card--checked" : ""}`}>
            <input type="radio" name="algorithm" checked={draft.algorithm === item.id} onChange={() => dispatch({ type: "chooseAlgorithm", algorithm: item.id })} />
            <span className="choice-top">
              <strong>{item.name}</strong>
              <span className="choice-subtitle">{item.fullName}</span>
              <StatusPill tone="success">可用</StatusPill>
            </span>
            <span className="choice-text">{item.summary}</span>
          </label>
        ))}
      </div>
      {chosen ? <AlgorithmDetail algorithm={chosen} /> : null}
    </>
  );
}

function AlgorithmDetail({ algorithm }: { algorithm: Algorithm }) {
  const participantSteps = algorithm.stages.filter((stage) => stage.side === "participant");
  const serverSteps = algorithm.stages.filter((stage) => stage.side === "server");
  return (
    <div className="algorithm-detail">
      <div className="flow-columns">
        <div className="flow-column">
          <h3>参与方（每方各自运行）</h3>
          <ol className="flow-steps">
            {participantSteps.map((stage, index) => (
              <li key={stage.id}><span className="flow-index">{index + 1}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div></li>
            ))}
          </ol>
          <p className="flow-keep"><strong>留在参与方</strong>{algorithm.keeps}</p>
        </div>
        <div className="flow-arrow" aria-hidden="true">
          <span>只上传 trace</span>
        </div>
        <div className="flow-column">
          <h3>服务端</h3>
          <ol className="flow-steps">
            {serverSteps.map((stage, index) => (
              <li key={stage.id}><span className="flow-index">{participantSteps.length + index + 1}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div></li>
            ))}
          </ol>
          <p className="flow-keep"><strong>下发给所有参与方</strong>完整的洞见库，进入下一轮</p>
        </div>
      </div>
      <dl className="facts facts--inline">
        <div><dt>上传内容</dt><dd>{algorithm.uploads}</dd></div>
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

function answersText(dataset: Dataset): string {
  if (dataset.answered >= dataset.count) return "全部带答案";
  if (dataset.answered === 0) return "无答案，只参与联邦";
  return `${dataset.answered} 题带答案`;
}

function DataChoices({
  state, dispatch, algorithm, candidates, selected,
}: {
  state: State;
  dispatch: Dispatch<Action>;
  algorithm: Algorithm;
  candidates: Dataset[];
  selected: Dataset[];
}) {
  const draft = state.draft;
  const usableIds = candidates.filter((dataset) => usable(dataset, state.participants)).map((dataset) => dataset.id);
  const waiting = state.participants.filter((participant) => participant.status !== "online" && !state.datasets.some((dataset) => dataset.participantId === participant.id));
  const total = selected.reduce((sum, dataset) => sum + dataset.count, 0);
  const used = selected.reduce((sum, dataset) => sum + problemsOf(draft, dataset), 0);

  return (
    <>
      <p className="section-lede">每份数据由一个参与方持有，至少选 {algorithm.minParticipants} 份。数据只在持有方使用，服务端只收到 trace。</p>
      <div className="data-toolbar">
        <span>
          已选 <strong>{selected.length}</strong> 份 · {formatNumber(total)} 题
          {draft.mode === "trial" && selected.length ? `（试跑每份取前 ${draft.trialCap} 题，共 ${formatNumber(used)} 题）` : ""}
        </span>
        <div className="toolbar-actions">
          <button type="button" className="button button--compact button--secondary" onClick={() => dispatch({ type: "setDatasets", datasetIds: usableIds })} disabled={selected.length === usableIds.length}>全选</button>
          <button type="button" className="button button--compact button--secondary" onClick={() => dispatch({ type: "setDatasets", datasetIds: [] })} disabled={!selected.length}>清空</button>
        </div>
      </div>
      <ul className="data-list">
        {candidates.map((dataset) => {
          const owner = participantOf(state, dataset.participantId);
          const enabled = usable(dataset, state.participants);
          const checked = enabled && draft.datasetIds.includes(dataset.id);
          return (
            <li key={dataset.id}>
              <label className={`data-row${checked ? " data-row--checked" : ""}${enabled ? "" : " data-row--disabled"}`}>
                <input type="checkbox" checked={checked} disabled={!enabled} onChange={() => dispatch({ type: "toggleDataset", datasetId: dataset.id })} />
                <span className="data-main">
                  <strong>{dataset.name}</strong>
                  <small>{dataset.description}</small>
                </span>
                <span className="data-owner">
                  {owner && owner.name !== dataset.name ? (
                    <>
                      <span>{owner.name}</span>
                      <small>{HOSTING_LABELS[owner.hosting]} · {PARTICIPANT_STATUS[owner.status]}</small>
                    </>
                  ) : (
                    <>
                      <span>{owner ? HOSTING_LABELS[owner.hosting] : "未知参与方"}</span>
                      <small>{owner ? `持有方${PARTICIPANT_STATUS[owner.status]}` : ""}</small>
                    </>
                  )}
                </span>
                <span className="data-count">
                  <span>{formatNumber(dataset.count)} 题</span>
                  <small>{answersText(dataset)}</small>
                </span>
              </label>
            </li>
          );
        })}
        {waiting.map((participant) => (
          <li key={participant.id}>
            <div className="data-row data-row--waiting">
              <span className="data-main">
                <strong>{participant.name}</strong>
                <small>{HOSTING_LABELS[participant.hosting]} · {PARTICIPANT_STATUS[participant.status]}：连上客户端后，它登记的题库会出现在这里</small>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <a className="text-link" href={hrefOf({ page: "participants" })}>新增参与方或上传题库</a>
    </>
  );
}

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
  const overrides = activeOverrides(draft);

  return (
    <>
      <div className="setting-grid">
        <div className="setting setting--wide">
          <span className="setting-label" id="mode-label">运行方式</span>
          <div className="radio-row" role="radiogroup" aria-labelledby="mode-label">
            <label className={`radio-card${draft.mode === "trial" ? " radio-card--checked" : ""}`}>
              <input type="radio" name="mode" checked={draft.mode === "trial"} onChange={() => update({ mode: "trial" })} />
              <span><strong>试跑</strong><small>每份只取前几题，先确认流程和费用</small></span>
            </label>
            <label className={`radio-card${draft.mode === "full" ? " radio-card--checked" : ""}`}>
              <input type="radio" name="mode" checked={draft.mode === "full"} onChange={() => update({ mode: "full" })} />
              <span><strong>正式运行</strong><small>使用全部题目</small></span>
            </label>
          </div>
          {draft.mode === "trial" ? (
            <label className="inline-field">
              试跑时每份取前
              <input type="number" min={1} max={50} value={draft.trialCap} onChange={(event) => update({ trialCap: clampInt(event.target.value, 1, 50, draft.trialCap) })} />
              题
            </label>
          ) : null}
        </div>

        <div className="setting setting--wide">
          <span className="setting-label" id="rounds-label">轮次</span>
          <NumberStepper
            labelledBy="rounds-label"
            value={draft.rounds}
            min={algorithm.minRounds}
            max={algorithm.maxRounds}
            unit="轮"
            onChange={(rounds) => update({ rounds })}
          />
          <small className="setting-hint">第 1 轮还没有洞见库，相当于各方单独作答，是对比的基线。</small>
        </div>

        <label className="setting">
          <span className="setting-label">参与方模型</span>
          <select value={draft.clientModel} onChange={(event) => update({ clientModel: event.target.value })}>
            {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
          </select>
          <small className="setting-hint">平台托管的参与方用它解题、反思和提取 trace；本地参与方用自己的模型。默认走预留的 LLM 接口，服务和模型之后再配置。</small>
        </label>

        <label className="setting">
          <span className="setting-label">服务端模型</span>
          <select value={draft.serverModel} onChange={(event) => update({ serverModel: event.target.value })}>
            {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
          </select>
          <small className="setting-hint">服务端每轮一次读完所有 trace，需要长上下文的模型。</small>
        </label>
      </div>

      <details className="advanced">
        <summary>高级设置</summary>
        <div className="advanced-body">
          <fieldset className="setting">
            <legend className="setting-label">为参与方分别指定模型</legend>
            <ul className="override-list">
              {selected.map((dataset) => (
                <li key={dataset.id}>
                  <span>{participantOf(state, dataset.participantId)?.name ?? dataset.name}</span>
                  <select
                    aria-label={`${dataset.name} 使用的模型`}
                    value={overrides[dataset.id] ?? ""}
                    onChange={(event) => {
                      const next = { ...draft.clientOverrides };
                      if (event.target.value) next[dataset.id] = event.target.value;
                      else delete next[dataset.id];
                      update({ clientOverrides: next });
                    }}
                  >
                    <option value="">与参与方模型相同</option>
                    {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </fieldset>

          <fieldset className="setting">
            <legend className="setting-label">洞见库条数</legend>
            <div className="radio-list">
              {INSIGHT_TARGETS.map((target) => (
                <label key={target.id} className="radio-line">
                  <input type="radio" name="insight-target" checked={draft.insightTarget === target.id} onChange={() => update({ insightTarget: target.id })} />
                  <span><strong>{target.label}</strong><small>{target.hint}</small></span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="setting">
            <legend className="setting-label">trace 密度</legend>
            <div className="radio-list">
              {TRACE_DENSITIES.map((density) => (
                <label key={density.id} className="radio-line">
                  <input type="radio" name="trace-density" checked={draft.traceDensity === density.id} onChange={() => update({ traceDensity: density.id })} />
                  <span><strong>{density.label}</strong><small>{density.hint}</small></span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="setting-grid setting-grid--compact">
            <label className="setting">
              <span className="setting-label">每题最多 trace 数</span>
              <select value={draft.maxTracesPerItem ?? ""} onChange={(event) => update({ maxTracesPerItem: event.target.value ? Number(event.target.value) : null })}>
                <option value="">不限（论文设置）</option>
                {[1, 2, 3].map((value) => <option key={value} value={value}>{value} 条</option>)}
              </select>
            </label>
            <label className="setting">
              <span className="setting-label">汇总重试上限</span>
              <input type="number" min={1} max={20} value={draft.aggregationRetries} onChange={(event) => update({ aggregationRetries: clampInt(event.target.value, 1, 20, draft.aggregationRetries) })} />
              <small className="setting-hint">服务端结果不合法时重试；超过后任务暂停。</small>
            </label>
            <label className="setting">
              <span className="setting-label">随机种子</span>
              <input type="number" min={0} value={draft.seed} onChange={(event) => update({ seed: clampInt(event.target.value, 0, 1_000_000, draft.seed) })} />
            </label>
            <label className="setting">
              <span className="setting-label">并发数</span>
              <input type="number" min={1} max={64} value={draft.workers} onChange={(event) => update({ workers: clampInt(event.target.value, 1, 64, draft.workers) })} />
              <small className="setting-hint">同时进行的模型调用数，受模型接口的并发上限约束。</small>
            </label>
          </div>
        </div>
      </details>
    </>
  );
}

function NumberStepper({
  value, min, max, unit, onChange, labelledBy,
}: {
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
  labelledBy: string;
}) {
  return (
    <div className="stepper" role="group" aria-labelledby={labelledBy}>
      <button type="button" aria-label="减少" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <output aria-live="polite">{value} {unit}</output>
      <button type="button" aria-label="增加" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function clientModelSummary(draft: Draft, state: State): string {
  const base = modelLabel(draft.clientModel, state.endpoints);
  const count = Object.keys(activeOverrides(draft)).length;
  return count ? `${base}（${count} 方单独指定）` : base;
}

function EstimateBlock({ result, draft }: { result: Estimate; draft: Draft }) {
  const basis = ESTIMATE_BASIS;
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
      {draft.mode === "full" && result.participantCalls >= 1000 ? (
        <p className="summary-warning">正式运行要调用 {formatNumber(result.participantCalls)} 次，建议先试跑。</p>
      ) : null}
      <details className="basis">
        <summary>估算口径</summary>
        <p>
          每题每轮：解题约 {formatNumber(basis.tokensPerCall.solve)}、反思约 {formatNumber(basis.tokensPerCall.reflect)}、提取约 {formatNumber(basis.tokensPerCall.extract)} token；
          平均耗时解题 {basis.secondsPerCall.solve} 秒、反思 {basis.secondsPerCall.reflect} 秒、提取 {basis.secondsPerCall.extract} 秒，服务端每次 {basis.secondsPerServerCall} 秒。
          首次真实运行后按实测值校准。
        </p>
      </details>
    </div>
  );
}
