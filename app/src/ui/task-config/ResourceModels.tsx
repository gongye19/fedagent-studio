import { SelectField } from "../SelectField";
import { ModelPicker } from "../ModelPicker";
import { type Algorithm } from "../../domain/catalog";
import { type Draft } from "../../domain/config";
import { endpointOf, isConfigured, modelOptions } from "../../domain/resources";
import { hrefOf, type Route } from "../../state/route";
import { type State } from "../../state/store";
import { Choices, Field, FieldGroup } from "../console";
import { InlineError } from "./InlineError";

export function ResourceModels({
  state,
  draft,
  update,
  algorithm,
  modelsError,
  onIntake,
  allLocal,
}: {
  state: State;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  algorithm: Algorithm | null;
  modelsError?: string;
  onIntake: (kind: "clientModel" | "serverModel" | "agent") => void;
  allLocal: boolean;
}) {
  const options = modelOptions(state.endpoints);
  return (
    <div className="resource-models">
      <FieldGroup>
        <Field
          label="执行方式"
          labelId="execution-mode"
          info="内置流程由平台使用所选 LLM 执行；自有 Agent 由独立服务执行完整的本方步骤。选择 Agent 将把步骤所需样本发送到该服务，Agent 自己管理模型与工具。"
        >
          <Choices
            labelledBy="execution-mode"
            value={draft.execution ?? "builtin"}
            options={[
              { value: "builtin", label: "平台内置流程", disabled: !algorithm },
              { value: "agent", label: "自有 Agent", disabled: !algorithm },
            ]}
            onChange={(execution) => update({ execution })}
          />
        </Field>
        {draft.execution === "agent" ? (
          <Field
            label="Agent 接口"
            htmlFor="task-agent"
            info="服务必须支持当前算法的版本与全部参与方步骤；开始前通过测试配置验证。"
          >
            <div className="resource-model-control">
              <SelectField
                aria-invalid={Boolean(modelsError)}
                aria-describedby={modelsError ? "models-error" : undefined}
                id="task-agent"
                name="task-agent"
                value={draft.agentId ?? ""}
                disabled={!algorithm || !state.agents.length}
                onValueChange={(agentId) => update({ agentId })}
              >
                <option value="" disabled>
                  {state.agents.length ? "选择 Agent 接口" : "暂无 Agent 接口"}
                </option>
                {state.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                    {agent.resourceSpace === "public" ? "（公用）" : ""}
                  </option>
                ))}
              </SelectField>
              <button
                type="button"
                className="button button--secondary button--compact"
                disabled={!algorithm}
                onClick={() => onIntake("agent")}
              >
                接入 Agent
              </button>
            </div>
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
            return (
              <Field
                key={role}
                label={role === "clientModel" ? "运行模型" : "汇总模型"}
                htmlFor={local ? undefined : id}
                info={
                  role === "clientModel"
                    ? "用于平台运行的数据来源。本地客户端自行配置模型，不使用这里的密钥。"
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
                        disabled={!algorithm}
                        placeholder={!algorithm ? "请先选择算法" : undefined}
                        aria-describedby={modelsError ? "models-error" : undefined}
                        onValueChange={(value) => update({ [role]: value })}
                        options={options}
                        endpoints={state.endpoints}
                      />
                      <button
                        type="button"
                        className="button button--secondary button--compact"
                        disabled={!algorithm}
                        onClick={() => onIntake(role)}
                      >
                        接入 LLM
                      </button>
                    </div>
                    {algorithm ? <EndpointSetupLink model={draft[role]} state={state} /> : null}
                  </>
                )}
              </Field>
            );
          })}
      </FieldGroup>
      <InlineError id="models-error" message={modelsError} />
    </div>
  );
}

function EndpointSetupLink({ model, state }: { model: string; state: State }) {
  const endpoint = endpointOf(model, state.endpoints);
  return endpoint && !isConfigured(endpoint) ? (
    <a className="text-link" href={hrefOf(endpointRoute(endpoint.id))}>
      去配置接口
    </a>
  ) : null;
}

const endpointRoute = (id: string): Route => ({ page: "editEndpoint", id, from: "newTask" });
