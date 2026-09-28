import { useEffect, useRef, useState, type Dispatch } from "react";
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
import { HOSTING_LABELS, modelLabel, modelOptions, usable, type Dataset, type Participant } from "../domain/resources";
import { hrefOf, navigate } from "../state/route";
import { participantOf, type Action, type State } from "../state/store";
import { PageHead, Section, Segmented } from "./common";
import { formatDuration, formatNumber, formatTokens, formatYuan } from "./format";
import { Icon } from "./icons";

type Props = { state: State; dispatch: Dispatch<Action>; scenario?: ScenarioId };

export default function NewTaskPage({ state, dispatch, scenario }: Props) {
  const draft = state.draft;
  const applied = useRef<ScenarioId | undefined>(undefined);
  const named = useRef(false);
  const [confirming, setConfirming] = useState(false);

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
      <div className="order-layout">
        <div className="order-main">
          <Section title="场景与算法" id="scenario">
            <ScenarioAndAlgorithm draft={draft} dispatch={dispatch} />
          </Section>

          {algorithm ? (
            <Section
              title="数据"
              id="data"
              meta={<DataSummary draft={draft} selected={selected} />}
              actions={<DataActions dispatch={dispatch} candidates={candidates} selected={selected} participants={state.participants} />}
            >
              <DataList state={state} dispatch={dispatch} candidates={candidates} selected={selected} />
            </Section>
          ) : null}

          {algorithm && selected.length ? (
            <Section title="运行设置" id="settings">
              <RunSettings state={state} draft={draft} update={update} algorithm={algorithm} selected={selected} />
            </Section>
          ) : null}
        </div>

        <aside className="order-summary" aria-label="任务配置" id="task-summary">
          <div className="summary-card">
            <label className="field">
              <span>任务名称</span>
              <input value={draft.name} placeholder={defaultTaskName(draft)} maxLength={60} onChange={(event) => update({ name: event.target.value })} />
            </label>
            <dl className="summary-list">
              <div><dt>场景与算法</dt><dd>{draft.scenario ? `${scenarioOf(draft.scenario).name.replace(" Agent", "")}${algorithm ? ` · ${algorithm.name}` : ""}` : "未选择"}</dd></div>
              <div><dt>参与方</dt><dd>{selected.length ? `${selected.length} 方 · ${formatNumber(result?.problems ?? 0)} 题` : "—"}</dd></div>
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

function ScenarioAndAlgorithm({ draft, dispatch }: { draft: Draft; dispatch: Dispatch<Action> }) {
  const current = draft.scenario ? scenarioOf(draft.scenario) : null;
  const algorithms = current ? algorithmsFor(current.id) : [];
  const chosen = draft.algorithm ? algorithmOf(draft.algorithm) : null;

  return (
    <div className="choice-stack">
      <div className="choice-field">
        <span className="setting-label" id="scenario-label">场景</span>
        <div className="choice-row" role="radiogroup" aria-labelledby="scenario-label">
          {SCENARIOS.map((item) => {
            const planned = item.status === "planned";
            const checked = draft.scenario === item.id;
            return (
              <label key={item.id} className={`choice${checked ? " choice--checked" : ""}${planned ? " choice--disabled" : ""}`}>
                <input type="radio" name="scenario" checked={checked} disabled={planned} onChange={() => dispatch({ type: "chooseScenario", scenario: item.id })} />
                {checked ? <Icon name="check" /> : null}
                <span>{item.name}</span>
                {planned ? <span className="choice-tag">规划中</span> : null}
              </label>
            );
          })}
        </div>
        {current ? <p className="choice-desc">{current.summary}</p> : null}
      </div>

      {current && algorithms.length ? (
        <div className="choice-field">
          <span className="setting-label" id="algorithm-label">算法</span>
          <div className="choice-row" role="radiogroup" aria-labelledby="algorithm-label">
            {algorithms.map((item) => {
              const checked = draft.algorithm === item.id;
              return (
                <label key={item.id} className={`choice${checked ? " choice--checked" : ""}`}>
                  <input type="radio" name="algorithm" checked={checked} onChange={() => dispatch({ type: "chooseAlgorithm", algorithm: item.id })} />
                  {checked ? <Icon name="check" /> : null}
                  <span>{item.name}</span>
                  <span className="choice-sub">{item.fullName}</span>
                </label>
              );
            })}
          </div>
          {chosen ? (
            <>
              <p className="choice-desc">{chosen.summary}</p>
              <details className="disclosure">
                <summary>每一轮怎么运行</summary>
                <AlgorithmFlow algorithm={chosen} />
              </details>
            </>
          ) : null}
        </div>
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

function DataSummary({ draft, selected }: { draft: Draft; selected: Dataset[] }) {
  const total = selected.reduce((sum, dataset) => sum + dataset.count, 0);
  const used = selected.reduce((sum, dataset) => sum + problemsOf(draft, dataset), 0);
  return (
    <>
      一份数据代表一个参与方，至少选 2 份。已选 <strong>{selected.length}</strong> 份 · {formatNumber(total)} 题
      {draft.mode === "trial" && selected.length ? `，试跑用其中 ${formatNumber(used)} 题` : ""}
    </>
  );
}

function DataActions({
  dispatch, candidates, selected, participants,
}: {
  dispatch: Dispatch<Action>;
  candidates: Dataset[];
  selected: Dataset[];
  participants: readonly Participant[];
}) {
  const usableIds = candidates.filter((dataset) => usable(dataset, participants)).map((dataset) => dataset.id);
  return (
    <>
      <button type="button" className="button button--ghost button--compact" onClick={() => dispatch({ type: "setDatasets", datasetIds: usableIds })} disabled={selected.length === usableIds.length}>全选</button>
      <button type="button" className="button button--ghost button--compact" onClick={() => dispatch({ type: "setDatasets", datasetIds: [] })} disabled={!selected.length}>清空</button>
    </>
  );
}

/** 每一行只标例外：参与方本地、离线、没有答案或只有部分答案。 */
function exceptions(dataset: Dataset, owner: Participant | undefined): string[] {
  const tags: string[] = [];
  if (owner && owner.hosting !== "platform") tags.push(HOSTING_LABELS[owner.hosting]);
  if (owner && owner.status !== "online") tags.push(owner.status === "waiting" ? "等待连接" : "离线");
  if (dataset.answered === 0) tags.push("无答案，只参与联邦");
  else if (dataset.answered < dataset.count) tags.push(`${dataset.answered} 题带答案`);
  return tags;
}

function DataList({
  state, dispatch, candidates, selected,
}: {
  state: State;
  dispatch: Dispatch<Action>;
  candidates: Dataset[];
  selected: Dataset[];
}) {
  const waiting = state.participants.filter((participant) => participant.status !== "online" && !state.datasets.some((dataset) => dataset.participantId === participant.id));
  const allPlain = candidates.every((dataset) => exceptions(dataset, participantOf(state, dataset.participantId)).length === 0);

  return (
    <>
      <ul className="data-list">
        {candidates.map((dataset) => {
          const owner = participantOf(state, dataset.participantId);
          const enabled = usable(dataset, state.participants);
          const checked = enabled && selected.some((item) => item.id === dataset.id);
          const tags = exceptions(dataset, owner);
          return (
            <li key={dataset.id}>
              <label className={`data-row${checked ? " data-row--checked" : ""}${enabled ? "" : " data-row--disabled"}`}>
                <input type="checkbox" checked={checked} disabled={!enabled} onChange={() => dispatch({ type: "toggleDataset", datasetId: dataset.id })} />
                <span className="data-name">
                  <strong>{dataset.name}</strong>
                  {owner && owner.name !== dataset.name ? <small>{owner.name}</small> : null}
                </span>
                <span className="data-desc">
                  {dataset.description}
                  {tags.map((tag) => <span key={tag} className="data-tag">{tag}</span>)}
                </span>
                <span className="data-count">{formatNumber(dataset.count)} 题</span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="data-foot">
        {allPlain ? <span>以上题库都由平台托管，都带标准答案。</span> : null}
        {waiting.length ? <span>{waiting.map((participant) => participant.name).join("、")}还在等待连接，连上后才能选择。</span> : null}
        <a className="text-link" href={hrefOf({ page: "participants" })}>新增参与方或上传题库</a>
      </p>
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
    <div className="settings">
      <div className="setting-row">
        <span className="setting-label">运行方式</span>
        <div className="setting-control">
          <Segmented
            label="运行方式"
            options={[{ id: "trial", label: "试跑" }, { id: "full", label: "正式运行" }]}
            value={draft.mode}
            onChange={(mode) => update({ mode })}
          />
          {draft.mode === "trial" ? (
            <label className="inline-field">
              每份前
              <input type="number" min={1} max={50} value={draft.trialCap} onChange={(event) => update({ trialCap: clampInt(event.target.value, 1, 50, draft.trialCap) })} />
              题
            </label>
          ) : <span className="setting-hint">使用全部题目</span>}
        </div>
      </div>

      <div className="setting-row">
        <span className="setting-label" id="rounds-label">轮次</span>
        <div className="setting-control">
          <NumberStepper labelledBy="rounds-label" value={draft.rounds} min={algorithm.minRounds} max={algorithm.maxRounds} unit="轮" onChange={(rounds) => update({ rounds })} />
        </div>
      </div>

      <div className="setting-row">
        <span className="setting-label">模型</span>
        <div className="setting-control setting-control--grid">
          <label className="field">
            <span>参与方</span>
            <select value={draft.clientModel} onChange={(event) => update({ clientModel: event.target.value })}>
              {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>服务端（需长上下文）</span>
            <select value={draft.serverModel} onChange={(event) => update({ serverModel: event.target.value })}>
              {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
            </select>
          </label>
          <p className="setting-hint">默认走预留的 LLM 接口，服务和模型之后再配置；本地参与方用自己的模型。</p>
        </div>
      </div>

      <details className="disclosure">
        <summary>高级设置</summary>
        <div className="advanced-body">
          <fieldset className="setting-group">
            <legend>为参与方分别指定模型</legend>
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

          <fieldset className="setting-group">
            <legend>洞见库条数</legend>
            <div className="radio-list">
              {INSIGHT_TARGETS.map((target) => (
                <label key={target.id} className="radio-line">
                  <input type="radio" name="insight-target" checked={draft.insightTarget === target.id} onChange={() => update({ insightTarget: target.id })} />
                  <span><strong>{target.label}</strong><small>{target.hint}</small></span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="setting-group">
            <legend>trace 密度</legend>
            <div className="radio-list">
              {TRACE_DENSITIES.map((density) => (
                <label key={density.id} className="radio-line">
                  <input type="radio" name="trace-density" checked={draft.traceDensity === density.id} onChange={() => update({ traceDensity: density.id })} />
                  <span><strong>{density.label}</strong><small>{density.hint}</small></span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="setting-grid">
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
            </label>
            <label className="field">
              <span>随机种子</span>
              <input type="number" min={0} value={draft.seed} onChange={(event) => update({ seed: clampInt(event.target.value, 0, 1_000_000, draft.seed) })} />
            </label>
            <label className="field">
              <span>并发数</span>
              <input type="number" min={1} max={64} value={draft.workers} onChange={(event) => update({ workers: clampInt(event.target.value, 1, 64, draft.workers) })} />
            </label>
          </div>
        </div>
      </details>
    </div>
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
      <button type="button" aria-label="减少" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Icon name="minus" /></button>
      <output>{value} {unit}</output>
      <button type="button" aria-label="增加" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Icon name="plus" /></button>
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
      <details className="basis">
        <summary>估算口径</summary>
        <p>
          每题每轮：解题约 {formatNumber(basis.tokensPerCall.solve)}、反思约 {formatNumber(basis.tokensPerCall.reflect)}、提取约 {formatNumber(basis.tokensPerCall.extract)} token；
          平均耗时解题 {basis.secondsPerCall.solve} 秒、反思 {basis.secondsPerCall.reflect} 秒、提取 {basis.secondsPerCall.extract} 秒，服务端每次 {basis.secondsPerServerCall} 秒。首次真实运行后按实测值校准。
        </p>
      </details>
    </div>
  );
}
