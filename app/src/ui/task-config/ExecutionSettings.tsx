import { AgentOverrides } from "./AgentOverrides";
import { SelectField } from "../SelectField";
import { ModelPicker } from "../ModelPicker";
import { paramValue, type Algorithm, type ParamDef, type ParamValue, type Params } from "../../domain/catalog";
import { activeOverrides, DEFAULT_DRAFT, type Draft, type RunMode } from "../../domain/config";
import { modelOptions } from "../../domain/resources";
import { participantOf, type State } from "../../state/store";
import { Collapsible, Tag } from "../common";
import { Choices, Field, FieldGroup, UnitInput } from "../console";
import { Icon } from "../icons";
import { InlineError } from "./InlineError";

const MODES: readonly { value: RunMode; label: string }[] = [
  { value: "trial", label: "试跑" },
  { value: "full", label: "正式运行" },
];

export function RunSettings({
  draft,
  update,
  algorithm,
  roundsError,
}: {
  roundsError?: string;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  algorithm: Algorithm | null;
}) {
  const rounds = algorithm
    ? Array.from({ length: algorithm.maxRounds - algorithm.minRounds + 1 }, (_, index) => algorithm.minRounds + index)
    : [];

  return (
    <div className="form-body">
      <FieldGroup>
        <Field
          label="运行方式"
          labelId="mode-label"
          info="试跑只使用每份数据集的前几条样本，适合先确认流程；正式运行使用所选数据集的全部样本。"
        >
          <Choices labelledBy="mode-label" value={draft.mode} options={MODES} onChange={(mode) => update({ mode })} />
        </Field>
        <Field label="试跑样本数" htmlFor="trial-cap" info="每份数据集使用的样本上限，仅影响试跑。">
          <UnitInput
            id="trial-cap"
            unit="条 / 数据集"
            name="trial-cap"
            type="number"
            inputMode="numeric"
            autoComplete="off"
            min={algorithm?.minSamples ?? 1}
            max={50}
            value={draft.mode === "trial" ? draft.trialCap : ""}
            disabled={draft.mode !== "trial"}
            placeholder="全部样本"
            onChange={(event) =>
              update({ trialCap: clampInt(event.target.value, algorithm?.minSamples ?? 1, 50, draft.trialCap) })
            }
          />
        </Field>
        <Field
          label="轮次"
          error={roundsError}
          htmlFor={algorithm ? undefined : "rounds-pending"}
          labelId="rounds-label"
          wide
          info={
            algorithm
              ? `第 1 轮各方单独作答，作为本地基线；之后每轮都带上上一轮的${algorithm.output.name}再作答。`
              : undefined
          }
        >
          {algorithm ? (
            <Choices
              error={roundsError}
              name="rounds"
              labelledBy="rounds-label"
              value={draft.rounds}
              options={rounds.map((value) => ({ value, label: `${value} 轮` }))}
              onChange={(value) => update({ rounds: value })}
            />
          ) : (
            <SelectField id="rounds-pending" disabled value="">
              <option value="">请先选择算法</option>
            </SelectField>
          )}
        </Field>
      </FieldGroup>
    </div>
  );
}

const GENERAL_KEYS = ["seed", "workers"] as const;

/** 高级配置默认收起：算法参数按注册表生成，另有几项通用设置。 */
export function AdvancedPanel({
  state,
  draft,
  update,
  algorithm,
  joined,
  error,
}: {
  error?: string;
  state: State;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  algorithm: Algorithm | null;
  /** 已选的参与方 id。 */
  joined: readonly string[];
}) {
  const changed =
    (algorithm?.params.filter((def) => paramValue(def, draft.params) !== def.default).length ?? 0) +
    GENERAL_KEYS.filter((key) => draft[key] !== DEFAULT_DRAFT[key]).length +
    Object.keys(activeOverrides(draft)).length;
  // 只有一个模型时没有可指定的，不显示这一项。
  const canOverride = draft.execution !== "agent" && modelOptions(state.endpoints).length > 1;
  return (
    <Collapsible
      className="panel panel--collapsible"
      title={<>高级配置{changed ? <Tag tone="info">已改 {changed} 项</Tag> : null}</>}
      sub="可选，默认值即推荐值"
    >
      <div className="form-body">
        <FieldGroup title={algorithm ? `${algorithm.name} 算法参数` : "算法参数"}>
          {algorithm ? (
            algorithm.params.map((def) => (
              <ParamField
                key={def.key}
                def={def}
                params={draft.params}
                onChange={(value) => update({ params: { ...draft.params, [def.key]: value } })}
              />
            ))
          ) : (
            <p className="field-static">请先选择算法</p>
          )}
          <InlineError id="params-error" message={error} />
        </FieldGroup>
        <FieldGroup title="通用">
          <Field label="并发数" htmlFor="workers" info="同时执行的工作单元数；LLM 或 Agent 服务还会受各自的并发限制。">
            <input
              id="workers"
              name="workers"
              type="number"
              inputMode="numeric"
              autoComplete="off"
              min={1}
              max={64}
              value={draft.workers}
              onChange={(event) => update({ workers: clampInt(event.target.value, 1, 64, draft.workers) })}
            />
          </Field>
          <Field
            label="随机种子"
            htmlFor="seed"
            info="记录在任务配置中；能否复现取决于算法和模型服务是否支持固定种子。"
          >
            <input
              id="seed"
              name="seed"
              type="number"
              inputMode="numeric"
              autoComplete="off"
              min={0}
              value={draft.seed}
              onChange={(event) => update({ seed: clampInt(event.target.value, 0, 1_000_000, draft.seed) })}
            />
          </Field>
          {draft.execution === "agent" && state.agents.length > 1 && joined.length ? <Field label="单独指定 Agent" wide><AgentOverrides state={state} draft={draft} joined={joined} update={update} /></Field> : null}
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
function ParamField({
  def,
  params,
  onChange,
}: {
  def: ParamDef;
  params: Params;
  onChange: (value: ParamValue) => void;
}) {
  const id = `param-${def.key}`;
  const value = paramValue(def, params);
  if (def.kind === "number") {
    const current = typeof value === "number" ? value : def.default;
    return (
      <Field label={def.label} htmlFor={id} info={def.help}>
        <UnitInput
          id={id}
          unit={def.unit}
          name={def.key}
          type="number"
          inputMode="numeric"
          autoComplete="off"
          min={def.min}
          max={def.max}
          value={current}
          onChange={(event) => onChange(clampInt(event.target.value, def.min, def.max, current))}
        />
      </Field>
    );
  }
  if (def.kind === "select-number") {
    return (
      <Field label={def.label} htmlFor={id} info={def.help}>
        <SelectField
          id={id}
          name={def.key}
          value={value ?? ""}
          onValueChange={(value) => onChange(value ? Number(value) : null)}
        >
          {def.options.map((option) => (
            <option key={String(option.value)} value={option.value ?? ""}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </Field>
    );
  }
  return (
    <Field label={def.label} htmlFor={id} info={def.help}>
      <SelectField
        id={id}
        name={def.key}
        value={String(value ?? def.default)}
        onValueChange={(value) => onChange(value)}
      >
        {def.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectField>
    </Field>
  );
}

/** 默认所有参与方用同一个模型；需要时逐条添加例外。每条一行：参与方、模型、移除。 */
function ModelOverrides({
  state,
  draft,
  update,
  joined,
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
          <div className="override-row override-head" aria-hidden="true">
            <span>参与方</span>
            <span>模型</span>
            <span />
          </div>
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
                {[participantId, ...free].map((id) => (
                  <option key={id} value={id}>
                    {nameOf(id)}
                  </option>
                ))}
              </SelectField>
              <ModelPicker
                aria-label={`${nameOf(participantId)} 使用的模型`}
                value={ref}
                onValueChange={(value) => set({ ...overrides, [participantId]: value })}
                options={options}
                endpoints={state.endpoints}
              />
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
        <button
          type="button"
          className="button button--secondary button--compact"
          onClick={() => set({ ...overrides, [free[0]]: draft.clientModel })}
        >
          <Icon name="plus" />
          为某个参与方指定
        </button>
      ) : null}
    </div>
  );
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
