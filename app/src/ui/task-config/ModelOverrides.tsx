import { Icon } from "../icons";
import { SelectField } from "../SelectField";
import { ModelPicker } from "../ModelPicker";
import { activeOverrides, type Draft } from "../../domain/config";
import { modelOptions } from "../../domain/resources";
import { participantOf, type State } from "../../state/store";

/** 默认所有参与方用同一个模型；需要时逐条添加例外。每条一行：参与方、模型、移除。 */
export function ModelOverrides({
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
  const entries = Object.entries(overrides).filter(([id]) =>
    joined.includes(id),
  );
  const free = joined.filter((id) => !(id in overrides));
  const nameOf = (id: string) => participantOf(state, id)?.name ?? id;
  const set = (next: Record<string, string>) =>
    update({ clientOverrides: next });

  if (!joined.length)
    return <p className="field-static">先在“参与方”里选择参与方</p>;
  return (
    <div className="override-editor">
      {entries.length ? (
        <div
          className="override-list"
          role="group"
          aria-labelledby="overrides-label"
        >
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
                onValueChange={(value) =>
                  set({ ...overrides, [participantId]: value })
                }
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
