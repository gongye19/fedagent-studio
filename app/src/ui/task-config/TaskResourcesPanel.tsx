import { type Dispatch } from "react";
import { hrefOf } from "../../state/route";
import { participantOf, type Action, type State } from "../../state/store";
import { PanelEmpty } from "../common";
import { Panel } from "../console";
import { Icon } from "../icons";
import { InfoTip } from "../InfoTip";
import { AgentParticipationPanel } from "./AgentParticipationPanel";
import { InlineError } from "./InlineError";
import { ParticipantTable } from "./DataSelection";
import { ResourceModels } from "./ResourceModels";
import type { TaskConfigController } from "./useTaskConfig";

export function TaskResourcesPanel({
  state,
  dispatch,
  config,
}: {
  state: State;
  dispatch: Dispatch<Action>;
  config: TaskConfigController;
}) {
  const {
    draft,
    update,
    algorithm,
    scenarioId,
    taskType,
    candidates,
    joined,
    fieldError,
  } = config;
  const agentRequired = algorithm?.requirements.agentRequired;
  return (
    <Panel
      id="participants"
      step={2}
      title={
        <>
          所需资源
          <InfoTip label="资源选择">
            这里只选择已登记并通过基础检查的可用资源。新增或修改资源请使用左侧的数据资源、LLM
            接口页面。
            {agentRequired
              ? `每组选择一个 Agent 服务和同方病例。任务合计至少 ${algorithm.minParticipants} 方；可选择自己和其他方已共享的资源，不要求一个用户提供多组。`
              : "每个来源选择一份数据，可结合自己与其他方共享的数据。最少来源数是任务整体要求。"}
          </InfoTip>
        </>
      }
      extra={
        algorithm
          ? `已选 ${joined.length} ${agentRequired ? "组资源" : "个来源"}`
          : undefined
      }
    >
      {agentRequired ? (
        <AgentParticipationPanel state={state} config={config} />
      ) : (
        <>
          {!algorithm || !scenarioId || !taskType ? (
            <PanelEmpty>
              先选择应用和算法，再选择可用过程记录。
            </PanelEmpty>
          ) : candidates.length ? (
            <ParticipantTable
              error={fieldError("participants")}
              draft={draft}
              dispatch={dispatch}
              candidates={candidates}
            />
          ) : (
            <PanelEmpty>
              暂无匹配的可用数据。请先在左侧“数据资源”中上传并完成校验。
              <a className="text-link" href={hrefOf({ page: "resources" })}>
                查看数据资源
              </a>
            </PanelEmpty>
          )}
          {joined.length ? (
            <div className="resource-selection" aria-label="已选择的数据">
              {joined.map((p) => (
                <span key={p.participantId}>
                  <span>
                    {state.datasets.find((d) => d.id === p.datasetId)?.name}
                  </span>
                  <button
                    type="button"
                    aria-label={`移除 ${state.datasets.find((d) => d.id === p.datasetId)?.name}`}
                    onClick={() =>
                      dispatch({
                        type: "pickDataset",
                        participantId: p.participantId,
                        datasetId: null,
                      })
                    }
                  >
                    <Icon name="x" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <InlineError
            id="participants-error"
            message={fieldError("participants")}
          />

        </>
      )}
          <ResourceModels
            state={state}
            draft={draft}
            update={update}
            algorithm={algorithm}
            joined={joined.map((p) => p.participantId)}
            modelsError={fieldError("models")}
            allLocal={
              joined.length > 0 &&
              joined.every(
                (p) =>
                  participantOf(state, p.participantId)?.hosting === "local",
              )
            }
          />
    </Panel>
  );
}
