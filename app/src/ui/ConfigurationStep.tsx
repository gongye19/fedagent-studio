import type { ReactNode } from "react";
import {
  LAYERS,
  SCENARIO_LAYERS,
  SCENARIO_STEP,
  SECURITY_STEP,
  builtinProtection,
  canDeselect,
  currentLayer,
  displayOptions,
  enhancementOptions,
  isAutoSelected,
  layerApplies,
  type DisplayOption,
  type LayerDefinition,
  type Selection,
} from "../domain/selection";
import {
  INPUT_KIND_LABEL,
  SCENARIOS,
  type EnhancementId,
  type InputKind,
} from "../domain/taxonomy";
import type { Action } from "../state/store";

type Props = {
  selection: Selection;
  locked: boolean;
  dispatch: (action: Action) => void;
};

const GROUPS: InputKind[] = ["nodes", "files"];

/**
 * 先选场景（维度 1，按运行方式分组），训练场景的子项 1.1–1.2 自动填好，之后可调整但不能取消。
 * 维度 2 协作策略、维度 3 安全与隐私在场景之后。所有候选项始终展开；已选选项再点一次即取消。
 * 场景参数都有默认值，不在界面上展示。
 */
export default function ConfigurationStep({ selection, locked, dispatch }: Props) {
  // 未选场景时，当前该回答的是场景本身。
  const current = selection.scenario ? currentLayer(selection) : null;
  const subLayers = LAYERS.filter((layer) => SCENARIO_LAYERS.includes(layer.id));

  function renderLayer(layer: LayerDefinition) {
    return (
      <LayerCard
        layer={layer}
        title={layer.title}
        options={displayOptions(layer.id, selection)}
        value={selection[layer.id]}
        current={layer.id === current}
        inactive={!layerApplies(layer.id, selection)}
        // 场景确定后，子项的自动选中原因很明显，不再逐个标注。
        auto={Boolean(selection[layer.id]) && !(SCENARIO_LAYERS.includes(layer.id) && selection.scenario) && isAutoSelected(layer.id, selection)}
        fixed={!canDeselect(selection, layer.id)}
        locked={locked}
        sub={SCENARIO_LAYERS.includes(layer.id)}
        onChoose={(value) => dispatch({ type: "toggle", layer: layer.id, value })}
      />
    );
  }

  return (
    <div className="config-flow">
      <section
        className={`layer-card layer-card--dimension scenario-card layer-card--${selection.scenario ? "answered" : "current"}`}
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
        {/* 选了不需要子项的场景（统计分析、记忆联邦）时不显示子项；未选场景时子项置灰。 */}
        {!selection.scenario || subLayers.some((layer) => layerApplies(layer.id, selection)) ? (
          <ol className="scenario-dimensions" aria-label="场景子项">
            {subLayers.map((layer) => <li key={layer.id}>{renderLayer(layer)}</li>)}
          </ol>
        ) : null}
      </section>

      <ol className="layer-list" aria-label="维度 2–3">
        {LAYERS.filter((layer) => !SCENARIO_LAYERS.includes(layer.id)).map((layer) => (
          <li className="layer-row" key={layer.id}>{renderLayer(layer)}</li>
        ))}
        <li className="layer-row">
          <SecurityCard
            selection={selection}
            locked={locked}
            onToggle={(id) => dispatch({ type: "toggleEnhancement", id })}
          />
        </li>

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
          <span className="option-group-label" aria-hidden="true">{INPUT_KIND_LABEL[group]}</span>
          <div className="option-grid" role="radiogroup" aria-label={`场景 · ${INPUT_KIND_LABEL[group]}`}>
            {SCENARIOS.filter((scenario) => scenario.input.kind === group).map((scenario) => {
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
  layer, title, options, value, current, inactive, auto, fixed, locked, sub, onChoose, children,
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
  /** 场景子项：嵌在场景卡片里，标题低一级。 */
  sub: boolean;
  onChoose: (value: string) => void;
  children?: ReactNode;
}) {
  const headingId = `layer-${layer.id}`;
  const state = value ? "answered" : current ? "current" : inactive ? "inactive" : "waiting";
  const groups = [...new Set(options.map((option) => option.group))];
  // 只有一组时组名和标题重复，不再显示。
  const showGroups = groups.length > 1;
  const Heading = sub ? "h4" : "h3";

  return (
    <section className={`layer-card layer-card--${state}${sub ? " layer-card--sub" : " layer-card--dimension"}`} aria-labelledby={headingId}>
      <header className="layer-head">
        <span className="layer-step" aria-hidden="true">{layer.code}</span>
        <div className="layer-heading">
          <Heading id={headingId}>
            {title}
            {auto ? <span className="badge badge--auto">自动选中</span> : null}
          </Heading>
          <p>{layer.question}</p>
        </div>
      </header>

      {groups.map((group) => (
        <div className="option-group" key={group ?? "all"}>
          {showGroups && group ? <span className="option-group-label" aria-hidden="true">{group}</span> : null}
          <div
            className="option-grid"
            role="radiogroup"
            aria-labelledby={showGroups && group ? undefined : headingId}
            aria-label={showGroups && group ? `${title} · ${group}` : undefined}
          >
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

function SecurityCard({
  selection, locked, onToggle,
}: {
  selection: Selection;
  locked: boolean;
  onToggle: (id: EnhancementId) => void;
}) {
  const ready = Boolean(selection.strategy);
  const options = enhancementOptions(selection);
  return (
    <section className={`layer-card layer-card--dimension layer-card--${ready ? "answered" : "inactive"}`} aria-labelledby="layer-security">
      <header className="layer-head">
        <span className="layer-step" aria-hidden="true">{SECURITY_STEP.code}</span>
        <div className="layer-heading">
          <h3 id="layer-security">{SECURITY_STEP.title}</h3>
          <p>{SECURITY_STEP.question}</p>
        </div>
      </header>
      <div className="option-group">
        <span className="option-group-label">内置保护</span>
        <div className="mechanism-list" aria-label="内置保护">
          {builtinProtection(selection).map((item) => <span key={item}>{item}</span>)}
        </div>
      </div>
      <div className="option-group">
        <span className="option-group-label">可选增强（可多选）</span>
        <div className="option-grid" role="group" aria-label="可选增强">
          {options.map(({ enhancement, available }) => {
            const selected = selection.enhancements.includes(enhancement.id);
            return (
              <button
                type="button"
                role="checkbox"
                aria-checked={selected}
                className={`option-tile${selected ? " option-tile--selected" : ""}`}
                key={enhancement.id}
                disabled={!available || locked}
                onClick={() => onToggle(enhancement.id)}
              >
                <span className="option-top"><strong>{enhancement.label}</strong></span>
                <span className="option-hint">{enhancement.hint}</span>
                {selected && enhancement.caution ? <span className="option-warning">{enhancement.caution}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
