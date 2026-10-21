import { usableModelOptions } from "../../domain/resources";
import { paramValue, type Algorithm } from "../../domain/catalog";
import {
  activeOverrides,
  DEFAULT_DRAFT,
  type Draft,
} from "../../domain/config";
import { type State } from "../../state/store";
import { Collapsible, Tag } from "../common";
import { Field, FieldGroup } from "../console";
import { InlineError } from "./InlineError";
import { ParamField } from "./ParamField";
import { clampInt } from "../../domain/validate";
import { ModelOverrides } from "./ModelOverrides";

const GENERAL_KEYS = ["seed", "workers"] as const;

/** 高级配置默认收起：算法参数按注册表生成，另有几项通用设置。 */
export function AdvancedPanel({
  state,
  draft,
  update,
  algorithm,
  joined,
  error,
}: {
  error?: string;
  state: State;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  algorithm: Algorithm | null;
  /** 已选的参与方 id。 */
  joined: readonly string[];
}) {
  const changed =
    (algorithm?.params.filter(
      (def) => paramValue(def, draft.params) !== def.default,
    ).length ?? 0) +
    GENERAL_KEYS.filter((key) => draft[key] !== DEFAULT_DRAFT[key]).length +
    Object.keys(activeOverrides(draft)).length;
  // 只有一个模型时没有可指定的，不显示这一项。
  const canOverride =
    draft.execution !== "agent" &&
    usableModelOptions(state.endpoints).length > 1;
  return (
    <Collapsible
      className="panel panel--collapsible"
      title={
        <>高级配置{changed ? <Tag tone="info">已改 {changed} 项</Tag> : null}</>
      }
      sub="可选，默认值即推荐值"
    >
      <div className="form-body">
        <FieldGroup
          title={algorithm ? `${algorithm.name} 算法参数` : "算法参数"}
        >
          {algorithm ? (
            algorithm.params.map((def) => (
              <ParamField
                key={def.key}
                def={def}
                params={draft.params}
                onChange={(value) =>
                  update({ params: { ...draft.params, [def.key]: value } })
                }
              />
            ))
          ) : (
            <p className="field-static">请先选择算法</p>
          )}
          <InlineError id="params-error" message={error} />
        </FieldGroup>
        <FieldGroup title="通用">
          <Field
            label="并发数"
            htmlFor="workers"
            info="同时执行的工作单元数；LLM 或 Agent 服务还会受各自的并发限制。"
          >
            <input
              id="workers"
              name="workers"
              type="number"
              inputMode="numeric"
              autoComplete="off"
              min={1}
              max={64}
              value={draft.workers}
              onChange={(event) =>
                update({
                  workers: clampInt(event.target.value, 1, 64, draft.workers),
                })
              }
            />
          </Field>
          <Field
            label="随机种子"
            htmlFor="seed"
            info="记录在任务配置中；能否复现取决于算法和模型服务是否支持固定种子。"
          >
            <input
              id="seed"
              name="seed"
              type="number"
              inputMode="numeric"
              autoComplete="off"
              min={0}
              value={draft.seed}
              onChange={(event) =>
                update({
                  seed: clampInt(event.target.value, 0, 1_000_000, draft.seed),
                })
              }
            />
          </Field>
          {canOverride ? (
            <Field label="单独指定模型" labelId="overrides-label" wide>
              <ModelOverrides
                state={state}
                draft={draft}
                update={update}
                joined={joined}
              />
            </Field>
          ) : null}
        </FieldGroup>
      </div>
    </Collapsible>
  );
}
