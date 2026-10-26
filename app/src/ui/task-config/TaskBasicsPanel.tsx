import { type Dispatch } from "react";
import { type Action } from "../../state/store";
import { Field, FieldGroup, Panel } from "../console";
import { TaskTypeChoice, AlgorithmField } from "../task-config/TaskBasics";
import type { TaskConfigController } from "./useTaskConfig";

export function TaskBasicsPanel({ dispatch, config }: { dispatch: Dispatch<Action>; config: TaskConfigController }) {
  const { draft, update, algorithm, fieldError, autoName } = config;
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
          <AlgorithmField
            error={fieldError("algorithm")}
            value={draft.algorithm}
            onChange={(id) => dispatch({ type: "chooseAlgorithm", algorithm: id })}
          />
          <TaskTypeChoice
            error={fieldError("taskType")}
            algorithm={algorithm}
            value={draft.taskType}
            onChange={(taskType) => dispatch({ type: "chooseTaskType", taskType })}
          />
        </FieldGroup>
      </div>
    </Panel>
  );
}
