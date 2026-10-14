import { InfoTip } from "../InfoTip";
import { type Dispatch } from "react";
import { hrefOf } from "../../state/route";
import { participantOf, type Action, type State } from "../../state/store";
import { PanelEmpty } from "../common";
import { Panel } from "../console";
import { Icon } from "../icons";
import { InlineError } from "../task-config/InlineError";
import { ParticipantTable } from "../task-config/DataSelection";
import { ResourceModels } from "../task-config/ResourceModels";
import type { TaskConfigController } from "./useTaskConfig";
import { useContentMotion } from "../hooks";

export function TaskResourcesPanel({
  state,
  dispatch,
  config,
}: {
  state: State;
  dispatch: Dispatch<Action>;
  config: TaskConfigController;
}) {
  const { draft, space, setSpace, setIntake, update, algorithm, scenarioId, taskType, candidates, joined, fieldError } =
    config;
  const dataMotion = useContentMotion(space, true);
  return (
    <Panel title="所需资源" id="participants" step={2} extra={algorithm ? `已选 ${joined.length} 个来源` : undefined}>
      <div className="task-data-head">
        <div>
          <strong>数据</strong>
          <InfoTip label="数据选择">
            每个数据来源选择一份文件，同一来源的多份数据不能充当多个联邦节点。正式任务至少使用一份我的数据，公用数据可以先试跑。
          </InfoTip>
        </div>
        <button
          type="button"
          className="button button--secondary button--compact"
          disabled={!algorithm || !scenarioId || !taskType}
          onClick={() => setIntake("data")}
        >
          <Icon name="plus" />
          接入数据
        </button>
      </div>
      <div className="resource-space-bar" role="group" aria-label="数据资源范围">
        <button
          type="button"
          aria-pressed={space === "workspace"}
          className={space === "workspace" ? "active" : ""}
          onClick={() => setSpace("workspace")}
        >
          我的资源
        </button>
        <button
          type="button"
          aria-pressed={space === "public"}
          className={space === "public" ? "active" : ""}
          onClick={() => setSpace("public")}
        >
          公用资源
        </button>
      </div>
      <div ref={dataMotion}>
        {!algorithm || !scenarioId || !taskType ? (
          <PanelEmpty>先选择场景、任务类型和算法，再提交或选择数据。</PanelEmpty>
        ) : candidates.length ? (
          <ParticipantTable
            error={fieldError("participants")}
            draft={draft}
            dispatch={dispatch}
            candidates={candidates}
          />
        ) : (
          <PanelEmpty>
            {space === "workspace"
              ? "暂无匹配的可用数据。接入自己的数据，或切换到公用资源试跑。"
              : "暂无匹配的公用数据。"}
          </PanelEmpty>
        )}
      </div>
      {algorithm && state.datasets.some((d) => d.resourceSpace === space && d.taskType === taskType && !d.ready) ? (
        <a className="text-link resource-return" href={hrefOf({ page: "resources", space, kind: "data" })}>
          查看待连接的数据
        </a>
      ) : null}
      {joined.length ? (
        <div className="resource-selection" aria-label="已选择的数据">
          {joined.map((p) => (
            <span key={p.participantId}>
              <span>{state.datasets.find((d) => d.id === p.datasetId)?.name}</span>
              <button
                type="button"
                aria-label={`移除 ${state.datasets.find((d) => d.id === p.datasetId)?.name}`}
                onClick={() => dispatch({ type: "pickDataset", participantId: p.participantId, datasetId: null })}
              >
                <Icon name="x" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <InlineError id="participants-error" message={fieldError("participants")} />
      <ResourceModels
        state={state}
        draft={draft}
        update={update}
        algorithm={algorithm}
        modelsError={fieldError("models")}
        onIntake={setIntake}
        allLocal={joined.length > 0 && joined.every((p) => participantOf(state, p.participantId)?.hosting === "local")}
      />
    </Panel>
  );
}
