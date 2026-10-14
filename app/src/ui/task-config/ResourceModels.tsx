import { ModelPicker } from "../ModelPicker";
import { type Algorithm } from "../../domain/catalog";
import { type Draft } from "../../domain/config";
import { endpointOf, isConfigured, modelOptions } from "../../domain/resources";
import { hrefOf, type Route } from "../../state/route";
import { type State } from "../../state/store";
import { Field, FieldGroup } from "../console";
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
  onIntake: (kind: "clientModel" | "serverModel") => void;
  allLocal: boolean;
}) {
  const options = modelOptions(state.endpoints);
  return (
    <div className="resource-models">
      <FieldGroup>
        <Field
          label="执行流程"
          info="算法提供完整执行流程，选择数据即可使用；本地运行需安装对应算法插件。现有外部 Agent 服务的接入尚未支持。"
        >
          <p className="field-static">{algorithm?.requirements.executionLabel ?? "请先选择算法"}</p>
        </Field>
        {(["clientModel", "serverModel"] as const)
          .filter(
            (role) =>
              !algorithm ||
              (role === "clientModel" ? algorithm.requirements.participantModel : algorithm.requirements.serverModel),
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
                        接入模型
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
