import type { Dispatch } from "react";
import { compatibleAgents } from "../../domain/resources";
import type { Action, State } from "../../state/store";
import { PanelEmpty } from "../common";
import { Icon } from "../icons";
import { InfoTip } from "../InfoTip";
import { SelectField } from "../SelectField";
import { InlineError } from "./InlineError";
import type { TaskConfigController } from "./useTaskConfig";

/** 一个选择就是一组数据及其 Agent，公用组不允许在任务中替换系统。 */
export function AgentDataPanel({
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
    algorithm,
    candidates,
    space,
    binding,
    setIntake,
    setAgentTarget,
    fieldError,
  } = config;
  const agents = compatibleAgents(state.agents, algorithm);
  const rows = candidates.flatMap(({ participant, datasets }) => {
    const data =
      space === "public"
        ? datasets.filter(
            (d) => d.agentId && agents.some((a) => a.id === d.agentId),
          )
        : datasets;
    if (!data.length) return [];
    const picked = draft.participants.find(
      (p) => p.participantId === participant.id,
    )?.datasetId;
    return [
      {
        participant,
        datasets: data,
        shown: data.find((d) => d.id === picked) ?? data[0],
        checked: data.some((d) => d.id === picked),
      },
    ];
  });
  return (
    <>
      <div className="task-data-head">
        <div>
          <strong>数据与 Agent</strong>
          <InfoTip label="协作接入">
            每组由一份数据和一个执行完整本方流程的 Agent 组成，至少选择{" "}
            {algorithm?.minParticipants ?? 2} 个不同来源。
            可以使用自己的接入组并结合公用协作组；公用组使用其已绑定的
            Agent。当前为共用工作区，没有独立用户账号隔离。
          </InfoTip>
        </div>
        <button
          type="button"
          className="button button--secondary button--compact"
          disabled={!algorithm || !draft.taskType || Boolean(binding.pending)}
          onClick={() => setIntake("data")}
        >
          <Icon name="plus" />
          上传我的数据
        </button>
      </div>
      <div
        className="resource-space-bar"
        role="group"
        aria-label="协作接入范围"
      >
        {(
          [
            ["workspace", "我的接入"],
            ["public", "公用协作"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={space === value}
            className={space === value ? "active" : ""}
            onClick={() => config.setSpace(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {!draft.taskType ? (
        <PanelEmpty>先选择场景、算法和任务类型，再配置接入组。</PanelEmpty>
      ) : !rows.length ? (
        <PanelEmpty>
          {space === "workspace"
            ? "上传自己的数据并绑定 Agent，再选择公用协作组一起运行。"
            : "暂无可用的公用协作组。"}
        </PanelEmpty>
      ) : (
        <div
          className="agent-data-list"
          role="group"
          aria-label={space === "workspace" ? "我的接入组" : "公用协作组"}
        >
          {rows.map(({ participant, datasets, shown, checked }) => {
            const agent = state.agents.find((a) => a.id === shown.agentId);
            const id = `pick-${participant.id}`;
            const error =
              binding.error?.datasetId === shown.id
                ? binding.error.message
                : undefined;
            return (
              <div
                key={participant.id}
                className={`agent-data-row${checked ? " agent-data-row--checked" : ""}`}
              >
                <label className="agent-data-check">
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    aria-label={`选择 ${shown.name}`}
                    onChange={() =>
                      dispatch({
                        type: "pickDataset",
                        participantId: participant.id,
                        datasetId: checked ? null : shown.id,
                      })
                    }
                  />
                </label>
                <div className="agent-data-main">
                  <div className="agent-data-name">
                    {datasets.length > 1 ? (
                      <SelectField
                        name={`dataset-${participant.id}`}
                        aria-label={`${participant.name} 的数据`}
                        value={shown.id}
                        onValueChange={(datasetId) =>
                          dispatch({
                            type: "pickDataset",
                            participantId: participant.id,
                            datasetId,
                          })
                        }
                      >
                        {datasets.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </SelectField>
                    ) : (
                      <label htmlFor={id}>{shown.name}</label>
                    )}
                    <InfoTip label={`${shown.name} 的接入信息`}>
                      {shown.count} 条样本；{shown.origin || participant.name}。
                      {space === "public"
                        ? "团队提供的公用协作资源，不代表已有外部用户接入。"
                        : "此组使用我的数据及所选 Agent。"}
                    </InfoTip>
                  </div>
                  <div className="agent-data-agent">
                    {space === "public" ? (
                      <span className="agent-data-endpoint">
                        {agent?.name ?? "Agent 接口已失效"}
                      </span>
                    ) : (
                      <>
                        <SelectField
                          id={`data-agent-${shown.id}`}
                          name={`data-agent-${shown.id}`}
                          aria-label={`${shown.name} 的 Agent`}
                          aria-invalid={Boolean(error)}
                          aria-describedby={
                            error ? `binding-${shown.id}-error` : undefined
                          }
                          value={shown.agentId ?? ""}
                          disabled={Boolean(binding.pending)}
                          onValueChange={(value) =>
                            void binding.save(shown.id, value || null)
                          }
                        >
                          <option value="">选择 Agent 接口</option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </SelectField>
                        <button
                          type="button"
                          className="button button--secondary button--compact"
                          aria-label={`为 ${shown.name} 接入 Agent`}
                          disabled={Boolean(binding.pending)}
                          onClick={() => {
                            setAgentTarget(shown.id);
                            setIntake("agent");
                          }}
                        >
                          <Icon name="plus" />
                        </button>
                      </>
                    )}
                  </div>
                  {error ? (
                    <p
                      className="field-error"
                      role="alert"
                      id={`binding-${shown.id}-error`}
                    >
                      {error}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {draft.participants.length ? (
        <div className="resource-selection" aria-label="已选择的接入组">
          {draft.participants.map((p) => (
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
      <InlineError id="models-error" message={fieldError("models")} />
    </>
  );
}
