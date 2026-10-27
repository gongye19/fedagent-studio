import type { AgentGroup } from "../../domain/config";
import { groupChoices } from "../../domain/task-config/agent-groups";
import type { State } from "../../state/store";
import { Icon } from "../icons";
import { InlineError } from "./InlineError";
import { SelectField } from "../SelectField";
import type { TaskConfigController } from "./useTaskConfig";

export function AgentParticipationRow({
  group,
  index,
  state,
  config,
}: {
  group: AgentGroup;
  index: number;
  state: State;
  config: TaskConfigController;
}) {
  const { draft, algorithm, update } = config;
  const choices = groupChoices(
    group,
    draft,
    algorithm,
    state.agents,
    state.datasets,
    state.participants,
  );
  const prefix = `system-${group.key}`;
  const selectedData = choices.datasets.find((d) => d.id === group.datasetId);
  const agentMissing = Boolean(group.agentId && !choices.agent);
  const dataMissing = Boolean(group.datasetId && !selectedData);
  const attempted = Boolean(
    config.fieldError("participants") || config.fieldError("models"),
  );
  const agentError = agentMissing
    ? "接口已失效或取消共享，请重新选择"
    : attempted && !group.agentId
      ? "请选择 Agent 接口"
      : undefined;
  const dataError = dataMissing
    ? "数据已失效或取消共享，请重新选择"
    : attempted && !group.datasetId
      ? "请选择任务数据"
      : undefined;
  function patch(change: Partial<AgentGroup>) {
    update({
      agentGroups: draft.agentGroups.map((g) =>
        g.key === group.key ? { ...g, ...change } : g,
      ),
    });
  }
  return (
    <section className="participation-row" aria-label={`资源 ${index + 1}`}>
      <div className="participation-head">
        <strong>资源 {index + 1}</strong>
        <button
          type="button"
          className="button button--ghost button--compact"
          aria-label={`移除资源 ${index + 1}`}
          onClick={() =>
            update({
              agentGroups: draft.agentGroups.filter((g) => g.key !== group.key),
            })
          }
        >
          <Icon name="x" />
        </button>
      </div>
      <div className="participation-fields">
        <div>
          <label htmlFor={`${prefix}-agent`}>Agent 服务</label>
          <div className="participation-control">
            <SelectField
              id={`${prefix}-agent`}
              name={`${prefix}-agent`}
              value={group.agentId}
              aria-invalid={Boolean(agentError)}
              aria-describedby={
                agentError ? `${prefix}-agent-error` : undefined
              }
              disabled={
                !draft.taskType || (!choices.agents.length && !group.agentId)
              }
              onValueChange={(agentId) =>
                patch({ agentId, datasetId: "", participantId: "" })
              }
              onClear={() => patch({ agentId: "", datasetId: "", participantId: "" })}
            >
              <option value="" disabled>
                {choices.agents.length ? "选择 Agent 接口" : "暂无可用 Agent"}
              </option>
              {agentMissing ? (
                <option value={group.agentId} disabled>
                  接口已不可用，请重新选择
                </option>
              ) : null}
              {choices.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.resourceSpace === "workspace" ? "我的" : "共享"}
                </option>
              ))}
            </SelectField>
          </div>
          <InlineError id={`${prefix}-agent-error`} message={agentError} />
        </div>
        <div>
          <label htmlFor={`${prefix}-data`}>任务数据</label>
          <div className="participation-control">
            <SelectField
              id={`${prefix}-data`}
              name={`${prefix}-data`}
              value={group.datasetId}
              disabled={!choices.agent}
              aria-invalid={Boolean(dataError)}
              aria-describedby={dataError ? `${prefix}-data-error` : undefined}
              onValueChange={(datasetId) => {
                const data = choices.datasets.find((d) => d.id === datasetId);
                patch({ datasetId, participantId: data?.participantId ?? "" });
              }}
              onClear={() => patch({ datasetId: "", participantId: "" })}
            >
              <option value="" disabled>
                {!choices.agent
                  ? "先选择 Agent"
                  : choices.datasets.length
                    ? "选择该方的数据"
                    : "该方暂无可用数据"}
              </option>
              {dataMissing ? (
                <option value={group.datasetId} disabled>
                  数据已不可用，请重新选择
                </option>
              ) : null}
              {choices.datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.count} 条
                </option>
              ))}
            </SelectField>
          </div>
          <InlineError id={`${prefix}-data-error`} message={dataError} />
        </div>
      </div>
    </section>
  );
}
