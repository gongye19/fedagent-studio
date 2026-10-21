import type { State } from "../../state/store";
import type { ResourceSpace } from "../../domain/resources";
import { InfoTip } from "../InfoTip";
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
  const { draft, algorithm, update, fieldError } = config;
  function add(space: ResourceSpace) {
    update({
      agentGroups: [
        ...draft.agentGroups,
        {
          key: `system-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          space,
          agentId: "",
          datasetId: "",
          participantId: "",
        },
      ],
    });
  }
  return (
    <>
      <div className="task-data-head">
        <div>
          <strong>参与系统</strong>
          <InfoTip label="参与系统">
            每个系统选择一个 Agent 和同一方提供的数据，至少需要{" "}
            {algorithm?.minParticipants ?? 2} 个不同系统。 共享 Agent
            和共享数据分别授权。组合只用于本次任务，不改变资源。
            当前为共用工作区；团队提供的协作系统用于接入验证，尚无独立用户账号隔离。
          </InfoTip>
        </div>
      </div>
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
      <div className="participation-add">
        <button
          type="button"
          className="button button--secondary button--compact"
          disabled={!draft.taskType}
          onClick={() => add("workspace")}
        >
          <Icon name="plus" />
          添加我的系统
        </button>
        <button
          type="button"
          className="button button--secondary button--compact"
          disabled={!draft.taskType}
          onClick={() => add("public")}
        >
          <Icon name="plus" />
          添加共享协作方
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
