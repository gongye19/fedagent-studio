import { type Dispatch } from "react";
import { SCENARIOS } from "../../domain/catalog";
import { type Action } from "../../state/store";
import { Choices, Field, FieldGroup, Panel } from "../console";
import { TaskTypeChoice, AlgorithmField } from "../task-config/TaskBasics";
import type { TaskConfigController } from "./useTaskConfig";

export function TaskBasicsPanel({ dispatch, config }: { dispatch: Dispatch<Action>; config: TaskConfigController }) {
  const { draft, update, scenarioId, fieldError, autoName } = config;
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
          <Field
            label="场景"
            labelId="scenario-label"
            error={fieldError("scenario")}
            info="横向：各来源处理同类任务、持有不同样本；纵向：同一对象的信息分布在不同来源；迁移：把已有领域经验用于新领域。"
            wide
          >
            <Choices
              labelledBy="scenario-label"
              value={scenarioId}
              error={fieldError("scenario")}
              options={SCENARIOS.map((s) => ({
                value: s.id,
                label: s.short,
                disabled: s.status !== "available",
                badge: s.status !== "available" ? "待接入" : undefined,
              }))}
              onChange={(scenario) => dispatch({ type: "chooseScenario", scenario })}
            />
          </Field>
          <TaskTypeChoice
            error={fieldError("taskType")}
            scenario={scenarioId}
            value={draft.taskType}
            onChange={(taskType) => dispatch({ type: "chooseTaskType", taskType })}
          />
          <AlgorithmField
            error={fieldError("algorithm")}
            scenario={scenarioId}
            taskType={draft.taskType}
            value={draft.algorithm}
            onChange={(id) => dispatch({ type: "chooseAlgorithm", algorithm: id })}
          />
        </FieldGroup>
      </div>
    </Panel>
  );
}
