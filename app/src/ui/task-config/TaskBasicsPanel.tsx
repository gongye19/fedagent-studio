import { SCENARIOS } from "../../domain/catalog";
import { Choices, Field, FieldGroup, Panel } from "../console";
import { AlgorithmField, TaskTypeChoice } from "./TaskBasics";
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
          <Field label="联邦场景" labelId="scenario-label" wide error={fieldError("scenario")}
            info={SCENARIOS.map((scenario) => <p key={scenario.id}><strong>{scenario.short}：</strong>{scenario.summary}</p>)}>
            <Choices name="scenario" labelledBy="scenario-label" value={draft.scenario} error={fieldError("scenario")}
              options={SCENARIOS.map((item) => ({ value: item.id, label: item.short, badge: item.status === "planned" ? "待接入" : undefined }))}
              onChange={config.selectScenario} onClear={() => config.selectScenario(null)} />
            {config.scenarioPlanned ? <p className="field-static" role="status">该场景的算法待接入，接入后可在这里配置并运行任务。</p> : null}
          </Field>
          <TaskTypeChoice scenario={draft.scenario} value={draft.taskType} error={fieldError("taskType")} onChange={config.selectTaskType} />
          <AlgorithmField scenario={draft.scenario} error={fieldError("algorithm")} value={draft.algorithm} taskType={draft.taskType}
            onChange={(id) => config.selectAlgorithm(id)} />
        </FieldGroup>
      </div>
    </Panel>
  );
}
