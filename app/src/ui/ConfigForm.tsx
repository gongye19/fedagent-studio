import { DIMENSIONS, type DimensionId } from "../domain/dimensions";
import { visibleItems, type ItemId, type ItemState, type Selection } from "../domain/selection";
import { INPUT_KIND_LABEL, SCENARIOS, type InputKind } from "../domain/taxonomy";

type Props = {
  selection: Selection;
  onChoose: (item: ItemId, value: string) => void;
};

const GROUPS: InputKind[] = ["nodes", "files"];

/**
 * 新建项目的 7 个维度，按下单顺序从上到下排列，全部展开。
 * 选完场景后每个子项都带推荐值；由场景固定的子项显示为锁定值，与前面选择冲突的选项置灰。
 */
export default function ConfigForm({ selection, onChoose }: Props) {
  return (
    <div className="config-form">
      {DIMENSIONS.map((dimension) => (
        <section
          id={`dimension-${dimension.id}`}
          className={`dimension${dimension.id === 1 || selection.scenario ? " dimension--active" : ""}`}
          aria-labelledby={`dimension-${dimension.id}-title`}
          key={dimension.id}
        >
          <header className="dimension-head">
            <span className="dimension-step" aria-hidden="true">{dimension.id}</span>
            <div>
              <h3 id={`dimension-${dimension.id}-title`}>{dimension.title}</h3>
              <p>{dimension.question}</p>
            </div>
          </header>
          {dimension.id === 1
            ? <ScenarioPicker selection={selection} onChoose={onChoose} />
            : <DimensionItems dimension={dimension.id} selection={selection} onChoose={onChoose} />}
        </section>
      ))}
    </div>
  );
}

function ScenarioPicker({ selection, onChoose }: Props) {
  return (
    <div className="dimension-body">
      {GROUPS.map((group) => (
        <div className="option-group" key={group}>
          <span className="option-group-label" aria-hidden="true">{INPUT_KIND_LABEL[group]}</span>
          <div className="option-grid" role="radiogroup" aria-label={`协作场景 · ${INPUT_KIND_LABEL[group]}`}>
            {SCENARIOS.filter((scenario) => scenario.input === group).map((scenario) => {
              const selected = selection.scenario === scenario.id;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`option-tile${selected ? " option-tile--selected" : ""}`}
                  key={scenario.id}
                  onClick={() => onChoose("scenario", scenario.id)}
                >
                  <span className="option-top"><strong>{scenario.label}</strong></span>
                  <span className="option-hint">{scenario.hint}</span>
                  <span className="option-meta">{scenario.runner}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function DimensionItems({ dimension, selection, onChoose }: Props & { dimension: DimensionId }) {
  if (!selection.scenario) {
    return <p className="dimension-empty">选择协作场景后，平台给出本维度的配置项和推荐值。</p>;
  }
  return (
    <ol className="item-list">
      {visibleItems(dimension, selection).map((state) => (
        <li key={state.item.id}><ItemBlock state={state} onChoose={onChoose} /></li>
      ))}
    </ol>
  );
}

function ItemBlock({ state, onChoose }: { state: ItemState; onChoose: Props["onChoose"] }) {
  const { item, title, mode, candidates, value } = state;
  const headingId = `item-${item.id}`;
  const selected = candidates.find((candidate) => candidate.choice.id === value)?.choice;

  if (mode === "locked") {
    return (
      <div className="item item--locked">
        <div className="item-head">
          <span className="item-code" aria-hidden="true">{item.code}</span>
          <h4 id={headingId}>{title}</h4>
          <span className="badge">固定</span>
        </div>
        <p className="item-value">
          <strong>{selected?.label ?? "—"}</strong>
          {selected?.hint ? <span>{selected.hint}</span> : null}
        </p>
      </div>
    );
  }

  return (
    <div className="item">
      <div className="item-head">
        <span className="item-code" aria-hidden="true">{item.code}</span>
        <h4 id={headingId}>{title}</h4>
      </div>
      {item.display === "chips" ? (
        <>
          <div className="chip-group" role="radiogroup" aria-labelledby={headingId}>
            {candidates.map(({ choice, available }) => (
              <button
                type="button"
                role="radio"
                aria-checked={choice.id === value}
                className="chip"
                key={choice.id}
                disabled={!available}
                onClick={() => onChoose(item.id, choice.id)}
              >
                {choice.label}
              </button>
            ))}
          </div>
          {selected?.hint ? <p className="item-hint">{selected.hint}</p> : null}
        </>
      ) : (
        <div className="option-grid" role="radiogroup" aria-labelledby={headingId}>
          {candidates.map(({ choice, available }) => {
            const isSelected = choice.id === value;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={`option-tile${isSelected ? " option-tile--selected" : ""}`}
                key={choice.id}
                disabled={!available}
                onClick={() => onChoose(item.id, choice.id)}
              >
                <span className="option-top"><strong>{choice.label}</strong></span>
                {choice.hint ? <span className="option-hint">{choice.hint}</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

