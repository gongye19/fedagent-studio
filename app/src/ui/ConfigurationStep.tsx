import type { ReactNode } from "react";
import {
  LAYERS,
  PARAMS_STEP,
  SCENARIO_LAYERS,
  currentLayer,
  displayOptions,
  isAutoSelected,
  layerApplies,
  paramsFor,
  scenarioFor,
  type DisplayOption,
  type LayerDefinition,
  type Selection,
} from "../domain/selection";
import {
  PATTERN_LABEL,
  SCENARIOS,
  SCENARIO_GROUP_LABEL,
  protectionOf,
  type ScenarioGroup,
} from "../domain/taxonomy";
import type { Action } from "../state/store";

type Props = {
  selection: Selection;
  locked: boolean;
  dispatch: (action: Action) => void;
};

const GROUPS: ScenarioGroup[] = ["training", "analysis", "knowledge"];

/**
 * 所有维度和候选项始终展开；上游选完后，下游不支持的选项自动置灰。
 * 维度 1–5 和场景选择在同一张卡片里：可以直接选场景，也可以逐个维度选；
 * 场景确定后，维度 1–5 中会离开该场景的选项置灰。
 */
export default function ConfigurationStep({ selection, locked, dispatch }: Props) {
  const current = currentLayer(selection);
  const scenario = scenarioFor(selection);
  const params = paramsFor(selection);

  function renderLayer(layer: LayerDefinition, nested: boolean) {
    return (
      <LayerCard
        layer={layer}
        title={layer.id === "sharing" && selection.contribution === "trained-artifact" ? "模型形态 · 产物类型" : layer.title}
        options={displayOptions(layer.id, selection)}
        value={selection[layer.id]}
        current={layer.id === current}
        inactive={!layerApplies(layer.id, selection)}
        // 直接选了场景时，维度 1–5 的自动选中原因很明显，不再逐个标注。
        auto={Boolean(selection[layer.id]) && !(nested && selection.scenario) && isAutoSelected(layer.id, selection)}
        locked={locked}
        nested={nested}
        onChoose={(value) => dispatch({ type: "choose", layer: layer.id, value })}
      >
        {layer.id === "protection" ? <ProtectionExtras selection={selection} /> : null}
      </LayerCard>
    );
  }

  return (
    <div className="config-flow">
      <section className="layer-card scenario-card" aria-labelledby="scenario-card-title">
        <header className="scenario-card-head">
          <div>
            <h3 id="scenario-card-title"><span className="layer-number">维度 1–5</span>定位场景</h3>
            <p>直接选场景，下面的维度 1–5 会自动填好；也可以逐个维度往下选。场景确定后，维度 1–5 只能在该场景内调整，换场景请在这里重新选择。</p>
          </div>
          {selection.goal && !locked ? <button type="button" className="text-button" onClick={() => dispatch({ type: "reset" })}>清空</button> : null}
        </header>
        <ScenarioPicker
          activeId={selection.scenario ?? undefined}
          locked={locked}
          onApply={(id) => dispatch({ type: "applyTemplate", scenario: id })}
        />
        {scenario ? <ScenarioMatch selection={selection} /> : null}
        <ol className="scenario-dimensions" aria-label="维度 1–5">
          {LAYERS.filter((layer) => SCENARIO_LAYERS.includes(layer.id)).map((layer) => (
            <li key={layer.id}>{renderLayer(layer, true)}</li>
          ))}
        </ol>
      </section>

      <ol className="layer-list" aria-label="维度 6–8">
        {LAYERS.filter((layer) => !SCENARIO_LAYERS.includes(layer.id)).map((layer) => (
          <li className="layer-row" key={layer.id}>{renderLayer(layer, false)}</li>
        ))}

        <li className="layer-row">
          <section className={`layer-card${params.length ? " layer-card--answered" : " layer-card--inactive"}`} aria-labelledby="layer-params">
            <header className="layer-head">
              <span className="layer-step" aria-hidden="true">{PARAMS_STEP.step}</span>
              <div className="layer-heading">
                <h3 id="layer-params"><span className="layer-number">维度 {PARAMS_STEP.step}</span>{PARAMS_STEP.title}</h3>
                <p>{params.length ? PARAMS_STEP.question : "匹配到场景后显示该场景的可调参数"}</p>
              </div>
            </header>
            {params.length ? (
              <div className="params-grid">
                {params.map((param) => (
                  <label className="param-field" key={param.id}>
                    <span>{param.label}</span>
                    <select
                      value={selection.params[param.id] ?? param.defaultValue}
                      disabled={locked}
                      onChange={(event) => dispatch({ type: "setParam", id: param.id, value: event.target.value })}
                    >
                      {param.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            ) : null}
          </section>
        </li>
      </ol>
    </div>
  );
}

function ScenarioPicker({
  activeId, locked, onApply,
}: {
  activeId?: string;
  locked: boolean;
  onApply: (id: (typeof SCENARIOS)[number]["id"]) => void;
}) {
  return (
    <div className="template-groups" role="radiogroup" aria-label="场景">
      {GROUPS.map((group) => (
        <div className="template-group" key={group}>
          <span className="template-group-label">{SCENARIO_GROUP_LABEL[group]}</span>
          <div className="template-chips">
            {SCENARIOS.filter((scenario) => scenario.group === group).map((scenario) => (
              <button
                type="button"
                role="radio"
                className={`template-chip${activeId === scenario.id ? " template-chip--active" : ""}`}
                key={scenario.id}
                aria-checked={activeId === scenario.id}
                title={scenario.summary}
                disabled={locked}
                onClick={() => {
                  if (activeId !== scenario.id) onApply(scenario.id);
                }}
              >
                {scenario.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LayerCard({
  layer, title, options, value, current, inactive, auto, locked, nested, onChoose, children,
}: {
  layer: LayerDefinition;
  title: string;
  options: DisplayOption[];
  value: string | null;
  current: boolean;
  inactive: boolean;
  auto: boolean;
  locked: boolean;
  nested: boolean;
  onChoose: (value: string) => void;
  children?: ReactNode;
}) {
  const headingId = `layer-${layer.id}`;
  const state = value ? "answered" : current ? "current" : inactive ? "inactive" : "waiting";
  const groups = [...new Set(options.map((option) => option.group))];

  return (
    <section className={`layer-card layer-card--${state}${nested ? " layer-card--nested" : ""}`} aria-labelledby={headingId}>
      <header className="layer-head">
        <span className="layer-step" aria-hidden="true">{value ? "✓" : layer.step}</span>
        <div className="layer-heading">
          <h3 id={headingId}>
            <span className="layer-number">维度 {layer.step}</span>
            {title}
            {auto ? <span className="badge badge--auto">自动选中</span> : null}
          </h3>
          <p>{layer.question}</p>
        </div>
      </header>

      {groups.map((group) => (
        <div className="option-group" key={group ?? "all"}>
          {group ? <span className="option-group-label">{group}</span> : null}
          <div className="option-grid" role="radiogroup" aria-labelledby={headingId}>
            {options.filter((option) => option.group === group).map((option) => (
              <OptionTile
                key={option.choice.id}
                option={option}
                selected={option.choice.id === value}
                locked={locked}
                onChoose={onChoose}
              />
            ))}
          </div>
        </div>
      ))}
      {children}
    </section>
  );
}

function OptionTile({
  option, selected, locked, onChoose,
}: {
  option: DisplayOption;
  selected: boolean;
  locked: boolean;
  onChoose: (value: string) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`option-tile${selected ? " option-tile--selected" : ""}`}
      disabled={!option.available || locked}
      onClick={() => onChoose(option.choice.id)}
    >
      <span className="option-top">
        <strong>{option.choice.label}</strong>
      </span>
      <span className="option-hint">{option.choice.hint}</span>
      {option.warning ? <span className="option-warning">{option.warning}</span> : null}
    </button>
  );
}

function ScenarioMatch({ selection }: { selection: Selection }) {
  const scenario = scenarioFor(selection);
  if (!scenario) return null;
  return (
    <div className="scenario-match" role="status">
      <span className="scenario-match-label">当前场景</span>
      <div className="scenario-match-main">
        <strong>{scenario.label}</strong>
        <span className="badge">{PATTERN_LABEL[scenario.pattern(selection)]}</span>
      </div>
      <p>{scenario.summary}</p>
    </div>
  );
}

function ProtectionExtras({ selection }: { selection: Selection }) {
  const protection = protectionOf(selection.protection);
  if (!protection) return null;
  return (
    <div className="protection-extras">
      <div className="mechanism-list" aria-label="启用的保护机制">
        {protection.mechanisms.map((mechanism) => <span key={mechanism}>{mechanism}</span>)}
      </div>
    </div>
  );
}
