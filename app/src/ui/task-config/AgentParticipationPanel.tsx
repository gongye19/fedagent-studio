import { compatibleAgents } from "../../domain/resources";
import { hrefOf } from "../../state/route";
import type { State } from "../../state/store";
import { Icon } from "../icons";
import { AgentParticipationRow } from "./AgentParticipationRow";
import { InlineError } from "./InlineError";
import type { TaskConfigController } from "./useTaskConfig";

export function AgentParticipationPanel({
  state,
  config,
}: {
  state: State;
  config: TaskConfigController;
}) {
  const { draft, update, fieldError } = config;
  function add() {
    update({
      agentGroups: [
        ...draft.agentGroups,
        {
          key: `system-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          agentId: "",
          datasetId: "",
          participantId: "",
        },
      ],
    });
  }
  return (
    <>
      <div className="participation-list">
        {draft.agentGroups.map((group, index) => (
          <AgentParticipationRow
            key={group.key}
            group={group}
            index={index}
            state={state}
            config={config}
          />
        ))}
      </div>
      {config.algorithm &&
      !compatibleAgents(state.agents, config.algorithm).length ? (
        <p className="field-static">
          暂无通过能力检查的可用 Agent，请先在左侧{" "}
          <a className="text-link" href={hrefOf({ page: "agents" })}>
            Agent 接口
          </a>
          登记并检查。
        </p>
      ) : null}
      <div className="participation-add">
        <button
          type="button"
          className="button button--secondary button--compact"
          disabled={!draft.taskType}
          onClick={add}
        >
          <Icon name="plus" />
          添加资源
        </button>
      </div>
      <InlineError
        id="participants-error"
        message={fieldError("participants")}
      />
      <InlineError id="models-error" message={fieldError("models")} />
    </>
  );
}
