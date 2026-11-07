import { Field, FieldGroup, Panel } from "../console";
import { AlgorithmField } from "../task-config/TaskBasics";
import type { TaskConfigController } from "./useTaskConfig";

export function TaskBasicsPanel({ config }: { config: TaskConfigController }) {
  const { draft, update, fieldError, autoName } = config;
  return (
    <Panel title="任务配置" id="scenario" step={1}>
      <div className="form-body">
        <FieldGroup>
          <Field label="任务名称" htmlFor="task-name" wide>
            <input
              id="task-name"
              name="task-name"
              autoComplete="off"
              value={draft.name ?? autoName}
              placeholder={autoName}
              maxLength={60}
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>
          <Field label="协作场景" wide><p className="field-static">横向联邦 · 不同来源的问诊记录</p></Field>
          <AlgorithmField error={fieldError("algorithm")} value={draft.algorithm} taskType={draft.taskType}
            onChange={(id) => config.selectAlgorithm(id)} />
        </FieldGroup>
      </div>
    </Panel>
  );
}
