import type { ReactNode } from "react";
import {
  LAYERS,
  SCENARIO_LAYERS,
  SCENARIO_STEP,
  canDeselect,
  currentLayer,
  displayOptions,
  isAutoSelected,
  layerApplies,
  type DisplayOption,
  type LayerDefinition,
  type Selection,
} from "../domain/selection";
import {
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
 * 先选场景（维度 1），子项 1.1–1.6 自动填好，之后只能在场景内调整且不能取消。
 * 维度 2 协作策略、维度 3 安全与信任在场景之后。所有候选项始终展开；已选选项再点一次即取消。
 * 场景参数都有默认值，不在界面上展示。
 */
export default function ConfigurationStep({ selection, locked, dispatch }: Props) {
  // 未选场景时，当前该回答的是场景本身。
  const current = selection.scenario ? currentLayer(selection) : null;

  function renderLayer(layer: LayerDefinition) {
    return (
      <LayerCard
        layer={layer}
        title={layer.id === "sharing" && selection.contribution === "trained-artifact" ? "产物类型" : layer.title}
        options={displayOptions(layer.id, selection)}
        value={selection[layer.id]}
        current={layer.id === current}
        inactive={!layerApplies(layer.id, selection) || (SCENARIO_LAYERS.includes(layer.id) && !selection.scenario)}
        // 场景确定后，子项的自动选中原因很明显，不再逐个标注。
        auto={Boolean(selection[layer.id]) && !(SCENARIO_LAYERS.includes(layer.id) && selection.scenario) && isAutoSelected(layer.id, selection)}
        fixed={!canDeselect(selection, layer.id)}
        locked={locked}
        onChoose={(value) => dispatch({ type: "toggle", layer: layer.id, value })}
      >
        {layer.id === "protection" ? <ProtectionExtras selection={selection} /> : null}
      </LayerCard>
    );
  }

  return (
    <div className="config-flow">
      <section
        className={`layer-card scenario-card layer-card--${selection.scenario ? "answered" : "current"}`}
        aria-labelledby="scenario-card-title"
      >
        <header className="layer-head">
          <span className="layer-step" aria-hidden="true">{SCENARIO_STEP.code}</span>
          <div className="layer-heading">
            <h3 id="scenario-card-title">{SCENARIO_STEP.title}</h3>
            <p>{SCENARIO_STEP.question}</p>
          </div>
        </header>
        <ScenarioOptions
          activeId={selection.scenario}
          locked={locked}
          onApply={(id) => dispatch({ type: "applyTemplate", scenario: id })}
          onClear={() => dispatch({ type: "clearScenario" })}
        />
        <ol className="scenario-dimensions" aria-label="场景子项">
          {LAYERS.filter((layer) => SCENARIO_LAYERS.includes(layer.id)).map((layer) => (
            <li key={layer.id}>{renderLayer(layer)}</li>
          ))}
        </ol>
      </section>

      <ol className="layer-list" aria-label="维度 2–3">
        {LAYERS.filter((layer) => !SCENARIO_LAYERS.includes(layer.id)).map((layer) => (
          <li className="layer-row" key={layer.id}>{renderLayer(layer)}</li>
        ))}

      </ol>
    </div>
  );
}

function ScenarioOptions({
  activeId, locked, onApply, onClear,
}: {
  activeId: string | null;
  locked: boolean;
  onApply: (id: (typeof SCENARIOS)[number]["id"]) => void;
  onClear: () => void;
}) {
  return (
    <>
      {GROUPS.map((group) => (
        <div className="option-group" key={group}>
          <span className="option-group-label">{SCENARIO_GROUP_LABEL[group]}</span>
          <div className="option-grid" role="radiogroup" aria-label={SCENARIO_GROUP_LABEL[group]}>
            {SCENARIOS.filter((scenario) => scenario.group === group).map((scenario) => {
              const selected = activeId === scenario.id;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`option-tile${selected ? " option-tile--selected" : ""}`}
                  key={scenario.id}
                  disabled={locked}
                  onClick={() => (selected ? onClear() : onApply(scenario.id))}
                >
                  <span className="option-top"><strong>{scenario.label}</strong></span>
                  <span className="option-hint">{scenario.summary}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

function LayerCard({
  layer, title, options, value, current, inactive, auto, fixed, locked, onChoose, children,
}: {
  layer: LayerDefinition;
  title: string;
  options: DisplayOption[];
  value: string | null;
  current: boolean;
  inactive: boolean;
  auto: boolean;
  fixed: boolean;
  locked: boolean;
  onChoose: (value: string) => void;
  children?: ReactNode;
}) {
  const headingId = `layer-${layer.id}`;
  const state = value ? "answered" : current ? "current" : inactive ? "inactive" : "waiting";
  const groups = [...new Set(options.map((option) => option.group))];

  return (
    <section className={`layer-card layer-card--${state}`} aria-labelledby={headingId}>
      <header className="layer-head">
        <span className="layer-step" aria-hidden="true">{layer.code}</span>
        <div className="layer-heading">
          <h3 id={headingId}>
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
            {options.filter((option) => option.group === group).map((option) => {
              const selected = option.choice.id === value;
              return (
                <OptionTile
                  key={option.choice.id}
                  option={option}
                  selected={selected}
                  fixed={selected && fixed}
                  locked={locked}
                  onChoose={onChoose}
                />
              );
            })}
          </div>
        </div>
      ))}
      {children}
    </section>
  );
}

function OptionTile({
  option, selected, fixed, locked, onChoose,
}: {
  option: DisplayOption;
  selected: boolean;
  fixed: boolean;
  locked: boolean;
  onChoose: (value: string) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`option-tile${selected ? " option-tile--selected" : ""}${fixed ? " option-tile--fixed" : ""}`}
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
