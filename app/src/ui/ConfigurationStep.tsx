import { useState, type ReactNode } from "react";
import {
  PARAMS_STEP,
  currentLayer,
  isAutoSelected,
  layerOptions,
  paramsFor,
  robustState,
  scenarioFor,
  visibleLayers,
  type LayerDefinition,
  type LayerId,
  type OptionState,
  type Selection,
} from "../domain/selection";
import {
  PATTERN_LABEL,
  ROBUST_AGGREGATION,
  SCENARIOS,
  SCENARIO_GROUP_LABEL,
  protectionOf,
  strategyOf,
  type ScenarioGroup,
} from "../domain/taxonomy";
import type { Action } from "../state/store";
import { MaturityBadge } from "./common";

type Props = {
  selection: Selection;
  locked: boolean;
  dispatch: (action: Action) => void;
};

const GROUPS: ScenarioGroup[] = ["training", "analysis", "knowledge"];

export default function ConfigurationStep({ selection, locked, dispatch }: Props) {
  const [editing, setEditing] = useState<LayerId | null>(null);
  const layers = visibleLayers(selection);
  const current = currentLayer(selection);
  const scenario = scenarioFor(selection);
  const params = paramsFor(selection);

  function choose(layer: LayerId, value: string) {
    dispatch({ type: "choose", layer, value });
    setEditing(null);
  }

  return (
    <div className="config-flow">
      <TemplateBar
        activeId={scenario?.id}
        locked={locked}
        onApply={(id) => {
          dispatch({ type: "applyTemplate", scenario: id });
          setEditing(null);
        }}
        onClear={selection.goal ? () => {
          dispatch({ type: "reset" });
          setEditing(null);
        } : undefined}
      />

      <ol className="layer-list" aria-label="配置维度">
        {layers.map((layer) => (
          <LayerRow key={layer.id} layer={layer} selection={selection}>
            {layer.id === "strategy" && scenario ? <ScenarioMatch selection={selection} /> : null}
            <LayerCard
              layer={layer}
              options={layerOptions(layer.id, selection)}
              value={selection[layer.id]}
              auto={isAutoSelected(layer.id, selection)}
              expanded={!locked && (layer.id === current || layer.id === editing)}
              locked={locked}
              onEdit={() => setEditing((value) => (value === layer.id ? null : layer.id))}
              onChoose={(value) => choose(layer.id, value)}
            >
              {layer.id === "protection" && selection.protection ? (
                <ProtectionExtras selection={selection} locked={locked} dispatch={dispatch} />
              ) : null}
            </LayerCard>
          </LayerRow>
        ))}

        {selection.protection && params.length ? (
          <li className="layer-row">
            <section className="layer-card layer-card--answered" aria-labelledby="layer-params">
              <header className="layer-head">
                <span className="layer-step" aria-hidden="true">{PARAMS_STEP.step}</span>
                <div className="layer-heading">
                  <h3 id="layer-params"><span className="layer-number">维度 {PARAMS_STEP.step}</span>{PARAMS_STEP.title}</h3>
                  <p>{PARAMS_STEP.question}</p>
                </div>
              </header>
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
            </section>
          </li>
        ) : null}
      </ol>
    </div>
  );
}

function LayerRow({ layer, selection, children }: { layer: LayerDefinition; selection: Selection; children: ReactNode }) {
  return <li className={`layer-row${selection[layer.id] ? "" : " layer-row--open"}`}>{children}</li>;
}

function TemplateBar({
  activeId, locked, onApply, onClear,
}: {
  activeId?: string;
  locked: boolean;
  onApply: (id: (typeof SCENARIOS)[number]["id"]) => void;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="template-bar" aria-labelledby="template-title">
      <header className="template-head">
        <div>
          <h3 id="template-title">从场景模板开始</h3>
          <p>一键填好维度 1–5，策略和保护仍由你选择。也可以直接从下方逐层选择。</p>
        </div>
        <div className="template-actions">
          {onClear && !locked ? <button type="button" className="text-button" onClick={onClear}>清空</button> : null}
          <button type="button" className="button button--secondary button--small" aria-expanded={open} onClick={() => setOpen((value) => !value)} disabled={locked}>
            {open ? "收起模板" : "查看 10 个模板"}
          </button>
        </div>
      </header>
      {open && !locked ? (
        <div className="template-groups">
          {GROUPS.map((group) => (
            <div className="template-group" key={group}>
              <span className="template-group-label">{SCENARIO_GROUP_LABEL[group]}</span>
              <div className="template-chips">
                {SCENARIOS.filter((scenario) => scenario.group === group).map((scenario) => (
                  <button
                    type="button"
                    className={`template-chip${activeId === scenario.id ? " template-chip--active" : ""}`}
                    key={scenario.id}
                    aria-pressed={activeId === scenario.id}
                    title={scenario.summary}
                    onClick={() => {
                      onApply(scenario.id);
                      setOpen(false);
                    }}
                  >
                    <span>{scenario.label}</span>
                    <MaturityBadge maturity={scenario.maturity} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function LayerCard({
  layer, options, value, auto, expanded, locked, onEdit, onChoose, children,
}: {
  layer: LayerDefinition;
  options: OptionState[];
  value: string | null;
  auto: boolean;
  expanded: boolean;
  locked: boolean;
  onEdit: () => void;
  onChoose: (value: string) => void;
  children?: ReactNode;
}) {
  const selected = options.find((option) => option.choice.id === value);
  const headingId = `layer-${layer.id}`;
  return (
    <section className={`layer-card${value ? " layer-card--answered" : " layer-card--current"}`} aria-labelledby={headingId}>
      <header className="layer-head">
        <span className="layer-step" aria-hidden="true">{value ? "✓" : layer.step}</span>
        <div className="layer-heading">
          <h3 id={headingId}>
            <span className="layer-number">维度 {layer.step}</span>
            {layer.title}
          </h3>
          {selected && !expanded ? (
            <p className="layer-value">
              <strong>{selected.choice.label}</strong>
              {selected.choice.maturity ? <MaturityBadge maturity={selected.choice.maturity} /> : null}
              {auto ? <span className="badge badge--auto">唯一可选</span> : null}
            </p>
          ) : (
            <p>{layer.question}</p>
          )}
        </div>
        {value && !locked ? (
          <button type="button" className="text-button" aria-expanded={expanded} onClick={onEdit}>
            {expanded ? "收起" : auto ? "查看原因" : "更改"}
          </button>
        ) : null}
      </header>

      {expanded ? (
        <div className="option-grid" role="radiogroup" aria-labelledby={headingId}>
          {options.map((option) => <OptionTile key={option.choice.id} option={option} selected={option.choice.id === value} onChoose={onChoose} />)}
        </div>
      ) : null}
      {selected?.warning && !expanded ? <p className="option-warning option-warning--inline">{selected.warning}</p> : null}
      {children}
    </section>
  );
}

function OptionTile({ option, selected, onChoose }: { option: OptionState; selected: boolean; onChoose: (value: string) => void }) {
  const strategy = strategyOf(option.choice.id);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`option-tile${selected ? " option-tile--selected" : ""}`}
      disabled={!option.available}
      onClick={() => onChoose(option.choice.id)}
    >
      <span className="option-top">
        <strong>{option.choice.label}</strong>
        {option.choice.maturity ? <MaturityBadge maturity={option.choice.maturity} /> : null}
      </span>
      <span className="option-hint">{option.choice.hint}</span>
      {strategy && option.available ? <span className="option-meta">参考实现 · {strategy.references.join(" / ")}</span> : null}
      {option.reason ? <span className="option-reason">{option.reason}</span> : null}
      {option.warning ? <span className="option-warning">{option.warning}</span> : null}
    </button>
  );
}

function ScenarioMatch({ selection }: { selection: Selection }) {
  const scenario = scenarioFor(selection);
  if (!scenario) return null;
  return (
    <div className="scenario-match" role="status">
      <span className="scenario-match-label">已匹配场景</span>
      <div className="scenario-match-main">
        <strong>{scenario.label}</strong>
        <MaturityBadge maturity={scenario.maturity} />
        <span className="badge">{PATTERN_LABEL[scenario.pattern(selection)]}</span>
      </div>
      <p>{scenario.summary}</p>
    </div>
  );
}

function ProtectionExtras({ selection, locked, dispatch }: { selection: Selection; locked: boolean; dispatch: (action: Action) => void }) {
  const protection = protectionOf(selection.protection);
  const robust = robustState(selection);
  return (
    <div className="protection-extras">
      <div className="mechanism-list" aria-label="启用的保护机制">
        {protection?.mechanisms.map((mechanism) => <span key={mechanism}>{mechanism}</span>)}
        {selection.robust ? ROBUST_AGGREGATION.mechanisms.map((mechanism) => <span key={mechanism}>{mechanism}</span>) : null}
      </div>
      <label className={`robust-toggle${robust.available ? "" : " robust-toggle--disabled"}`}>
        <input
          type="checkbox"
          checked={selection.robust}
          disabled={locked || !robust.available}
          onChange={(event) => dispatch({ type: "setRobust", value: event.target.checked })}
        />
        <span>
          <strong>完整性 · {ROBUST_AGGREGATION.label}</strong>
          <small>{robust.available ? `${ROBUST_AGGREGATION.hint}（${ROBUST_AGGREGATION.mechanisms.join(" / ")}）` : robust.reason}</small>
        </span>
      </label>
    </div>
  );
}

