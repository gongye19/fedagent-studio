import { SelectField } from "../SelectField";
import { ModelPicker } from "../ModelPicker";
import { type Algorithm } from "../../domain/catalog";
import { type Draft } from "../../domain/config";
import { compatibleAgents, usableModelOptions } from "../../domain/resources";
import { hrefOf } from "../../state/route";
import { type State } from "../../state/store";
import { Choices, Field, FieldGroup } from "../console";
import { InlineError } from "./InlineError";
import { AgentOverrides } from "./AgentOverrides";

export function ResourceModels({
  state,
  draft,
  update,
  algorithm,
  modelsError,
  allLocal,
  joined,
}: {
  state: State;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  algorithm: Algorithm | null;
  modelsError?: string;
  allLocal: boolean;
  joined: readonly string[];
}) {
  const options = usableModelOptions(state.endpoints);
  const agents = compatibleAgents(state.agents, algorithm);
  const missingModel = Boolean(
    (!draft.serverModel && algorithm?.requirements.serverModel) ||
    (!draft.clientModel && algorithm?.requirements.participantModel && draft.execution !== "agent" && !allLocal),
  );
  return (
    <div className="resource-models">
      <FieldGroup>
        {algorithm &&
        algorithm.requirements.executionModes.includes("agent") &&
        !algorithm.requirements.agentRequired ? (
          <Field
            label="执行方式"
            labelId="execution-mode"
            info="内置流程由平台使用所选 LLM 执行；自有 Agent 由独立服务执行完整的本方步骤。选择 Agent 将把步骤所需样本发送到该服务，Agent 自己管理模型与工具。"
          >
            <Choices
              labelledBy="execution-mode"
              value={draft.execution ?? "builtin"}
              options={[
                {
                  value: "builtin",
                  label: "平台内置流程",
                  disabled: !algorithm,
                },
                { value: "agent", label: "自有 Agent", disabled: !algorithm },
              ]}
              onChange={(execution) => update({ execution })}
            />
          </Field>
        ) : null}
        {draft.execution === "agent" ? (
          <Field
            label="Agent 接口"
            htmlFor="task-agent"
            info="由接入方运行完整 Agent 系统，管理模型与工具。服务必须支持当前算法的版本和全部本方步骤；平台会向它发送所选样本并在开始前测试。"
          >
            <div className="resource-model-control">
              <SelectField
                aria-invalid={Boolean(modelsError)}
                aria-describedby={modelsError ? "models-error" : undefined}
                id="task-agent"
                name="task-agent"
                value={draft.agentId ?? ""}
                disabled={!algorithm || !agents.length}
                onValueChange={(agentId) => update({ agentId })}
              >
                <option value="" disabled>
                  {agents.length ? "选择 Agent 接口" : "暂无匹配的 Agent 接口"}
                </option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </SelectField>
            </div>
          </Field>
        ) : null}
        {draft.execution === "agent" &&
        joined.length > 1 &&
        agents.length > 0 ? (
          <Field
            label="分别指定"
            optional
            info="默认使用上方接口；需要不同 Agent 执行时，为对应的数据单独指定。"
          >
            <AgentOverrides
              state={state}
              agents={agents}
              draft={draft}
              joined={joined}
              update={update}
            />
          </Field>
        ) : null}
        {(["clientModel", "serverModel"] as const)
          .filter(
            (role) =>
              (role !== "clientModel" || draft.execution !== "agent") &&
              (!algorithm ||
                (role === "clientModel"
                  ? algorithm.requirements.participantModel
                  : algorithm.requirements.serverModel)),
          )
          .map((role) => {
            const local = role === "clientModel" && allLocal;
            const id = role === "clientModel" ? "client-model" : "server-model";
            const label = role === "clientModel" ? "运行模型" : "汇总模型";
            const error = modelsError && !local && !draft[role] ? `请选择${label}` : undefined;
            return (
              <Field
                key={role}
                label={label}
                htmlFor={local ? undefined : id}
                error={error}
                info={
                  role === "clientModel"
                    ? "平台使用该 LLM 执行算法声明的本方流程；无需另行接入 Agent。本地客户端自行配置模型。"
                    : "用于算法在服务端汇总各来源的交换内容。"
                }
              >
                {local ? (
                  <p className="field-static">由本地客户端配置</p>
                ) : (
                  <>
                    <div className="resource-model-control">
                      <ModelPicker
                        id={id}
                        name={id}
                        value={draft[role]}
                        disabled={!algorithm || !draft.taskType || !options.length}
                        placeholder={!algorithm ? "请先选择算法" : !draft.taskType ? "请先选择任务类型" : undefined}
                        aria-invalid={Boolean(error)}
                        aria-describedby={
                          error ? `${id}-error` : modelsError && !missingModel ? "models-error" : undefined
                        }
                        onValueChange={(value) => update({ [role]: value })}
                        onClear={() => update({ [role]: "" })}
                        options={options}
                        endpoints={state.endpoints}
                      />
                    </div>
                    {algorithm && !options.length ? (
                      <p className="field-static">
                        暂无可用模型，请先在左侧{" "}
                        <a
                          className="text-link"
                          href={hrefOf({ page: "models" })}
                        >
                          LLM 接口
                        </a>
                        完成配置。
                      </p>
                    ) : null}
                  </>
                )}
              </Field>
            );
          })}
      </FieldGroup>
      <InlineError id="models-error" message={missingModel ? undefined : modelsError} />
    </div>
  );
}
