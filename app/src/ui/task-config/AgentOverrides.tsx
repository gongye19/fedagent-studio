import type { Draft } from "../../domain/config";
import type { State } from "../../state/store";
import { SelectField } from "../SelectField";

/** 默认共用一个接口，只有需要时才为某份数据指定其他 Agent。 */
export function AgentOverrides({
  state,
  draft,
  joined,
  update,
}: {
  state: State;
  draft: Draft;
  joined: readonly string[];
  update: (patch: Partial<Draft>) => void;
}) {
  const entries = Object.entries(draft.agentOverrides ?? {}).filter(([id]) => joined.includes(id));
  const free = joined.filter((id) => !entries.some(([key]) => key === id));
  const set = (id: string, value: string | null) => {
    const next = { ...draft.agentOverrides };
    if (value) next[id] = value;
    else delete next[id];
    update({ agentOverrides: next });
  };
  const name = (id: string) =>
    state.datasets.find((d) => draft.participants.some((p) => p.participantId === id && p.datasetId === d.id))
      ?.name ?? id;
  return (
    <div className="override-editor">
      {entries.map(([id, value]) => (
        <div className="override-row" key={id}>
          <span>{name(id)}</span>
          <SelectField
            aria-label={`${name(id)} 的 Agent`}
            value={value}
            onValueChange={(next) => set(id, next)}
          >
            {state.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </SelectField>
          <button
            type="button"
            className="button button--ghost button--compact"
            aria-label={`移除 ${name(id)} 的单独指定`}
            onClick={() => set(id, null)}
          >
            移除
          </button>
        </div>
      ))}
      {free.length ? (
        <SelectField
          aria-label="为数据单独指定 Agent"
          value=""
          onValueChange={(id) => set(id, draft.agentId ?? state.agents[0]?.id ?? null)}
        >
          <option value="">为数据单独指定 Agent</option>
          {free.map((id) => (
            <option key={id} value={id}>
              {name(id)}
            </option>
          ))}
        </SelectField>
      ) : null}
    </div>
  );
}
