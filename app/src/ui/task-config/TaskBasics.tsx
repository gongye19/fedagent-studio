import { InfoTip } from "../InfoTip";
import {
  algorithmsFor,
  recordTaskTypesFor,
  TASK_TYPES,
  type Algorithm,
  type ScenarioId,
  type TaskType,
} from "../../domain/catalog";
import { type Draft } from "../../domain/config";
import { Choices, Field } from "../console";

/** 后续任务类型和算法按场景匹配。 */
export function TaskTypeChoice({
  scenario,
  value,
  onChange,
  error,
}: {
  scenario: ScenarioId | null;
  error?: string;
  value: TaskType | null;
  onChange: (type: TaskType | null) => void;
}) {
  const types = recordTaskTypesFor(scenario);
  return (
    <Field
      label="任务类型"
      labelId="task-type-label"
      wide
      error={error}
      info="任务类型决定所需数据的格式和可用算法。"
    >

      {types.length ? (
        <Choices
          name="task-type"
          error={error}
          labelledBy="task-type-label"
          value={value}
          options={types.map((type) => ({ value: type, label: TASK_TYPES[type].label }))}
          onChange={onChange}
          onClear={() => onChange(null)}
        />
      ) : (
        <p className="field-static">{scenario ? "暂无可用任务类型" : "请先选择联邦场景"}</p>
      )}
    </Field>
  );
}

/** 算法按注册表列出；短名称供选择，说明、交换内容与产出通过 ⓘ 查看。 */
export function AlgorithmField({
  scenario,
  value,
  onChange,
  error,
  taskType,
}: {
  scenario: ScenarioId | null;
  taskType?: string | null;
  error?: string;
  value: Draft["algorithm"];
  onChange: (id: Algorithm["id"] | null) => void;
}) {
  const algorithms = scenario && taskType ? algorithmsFor(scenario).filter((a) => a.accepts.includes(taskType)) : [];
  return (
    <Field label="算法" labelId="algorithm-label" wide error={error}>
      {algorithms.length ? (
        <AlgorithmTable error={error} algorithms={algorithms} value={value} onChange={onChange} />
      ) : (
        <p className="field-static">{taskType ? "暂无可用算法" : "请先选择任务类型"}</p>
      )}
    </Field>
  );
}

/** 算法短名称紧凑选择，详细说明通过独立 ⓘ 浮层查看。 */
function AlgorithmTable({
  algorithms,
  value,
  onChange,
  error,
}: {
  error?: string;
  algorithms: readonly Algorithm[];
  value: Draft["algorithm"];
  onChange: (id: Algorithm["id"] | null) => void;
}) {
  return (
    <div
      className="algorithm-options"
      role="radiogroup"
      aria-labelledby="algorithm-label"
      aria-invalid={Boolean(error)}
      aria-describedby={error ? "algorithm-label-error" : undefined}
    >
      {algorithms.map((item) => (
        <div
          key={item.id}
          className={`algorithm-choice${value === item.id ? " algorithm-choice--checked" : ""}`}
        >
          <label className="algorithm-choice-main" htmlFor={`algorithm-${item.id}`}>
            <input
              id={`algorithm-${item.id}`}
              type="radio"
              name="algorithm"
              checked={value === item.id}
              aria-label={item.name}
              onChange={() => onChange(item.id)}
              onKeyDown={(event) => {
                if (event.key === " " && value === item.id) {
                  event.preventDefault();
                  onChange(null);
                }
              }}
              onClick={(event) => {
                if (value === item.id) {
                  event.preventDefault();
                  onChange(null);
                }
              }}
            />
            <span>{item.name}</span>
          </label>
          <InfoTip label={item.name}>
            <strong>{item.fullName}</strong>
            <p>{item.summary}</p>
            <dl className="algorithm-tip-facts">
              <div>
                <dt>交换内容</dt>
                <dd>{item.exchange}</dd>
              </div>
              <div>
                <dt>产出</dt>
                <dd>{item.output.name}</dd>
              </div>
            </dl>
          </InfoTip>
        </div>
      ))}
      <div
        className="algorithm-choice algorithm-choice--placeholder"
        aria-disabled="true"
        aria-label="更多算法，待接入"
      >
        <span>待接入</span>
      </div>
    </div>
  );
}
