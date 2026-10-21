import { InfoTip } from "../InfoTip";
import {
  ALGORITHMS,
  algorithmsFor,
  TASK_TYPES,
  type Algorithm,
  type ScenarioId,
  type TaskType,
} from "../../domain/catalog";
import { type Draft } from "../../domain/config";
import { Choices, Field } from "../console";

/** 任务类型：列出已选算法支持的类型，由用户选；指标跟着任务类型走。最后留一个"待接入"的空位。 */
export function TaskTypeChoice({
  algorithm,
  value,
  onChange,
  error,
}: {
  error?: string;
  algorithm: Algorithm | null;
  value: TaskType | null;
  onChange: (type: TaskType | null) => void;
}) {
  const types = algorithm ? algorithm.accepts : Object.keys(TASK_TYPES);
  return (
    <Field
      label="任务类型"
      labelId="task-type-label"
      wide
      error={error}
      info="只列出已选算法支持的任务；任务类型决定数据模板、评估指标与可用数据。"
    >
      {!algorithm ? <p className="field-static">请先选择算法</p> : null}
      {types.length ? (
        <Choices
          name="task-type"
          error={error}
          labelledBy="task-type-label"
          value={value}
          options={types.map((type) => ({ value: type, label: TASK_TYPES[type].label, disabled: !algorithm }))}
          placeholder="更多类型"
          onChange={onChange}
          onClear={() => onChange(null)}
        />
      ) : (
        <p className="field-static">这个算法还没有可用的任务类型。</p>
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
}: {
  error?: string;
  scenario: ScenarioId | null;
  value: Draft["algorithm"];
  onChange: (id: Algorithm["id"] | null) => void;
}) {
  const algorithms = scenario ? algorithmsFor(scenario) : ALGORITHMS;
  return (
    <Field label="算法" labelId="algorithm-label" wide error={error}>
      {!scenario ? (
        <p className="field-static" id="algorithm-prerequisite">
          请先选择场景
        </p>
      ) : null}
      {algorithms.length ? (
        <AlgorithmTable error={error} algorithms={algorithms} value={value} onChange={onChange} disabled={!scenario} />
      ) : (
        <p className="field-static">这个场景还没有可用算法。</p>
      )}
    </Field>
  );
}

/** 算法短名称紧凑选择，详细说明通过独立 ⓘ 浮层查看。 */
function AlgorithmTable({
  algorithms,
  value,
  onChange,
  disabled,
  error,
}: {
  error?: string;
  algorithms: readonly Algorithm[];
  value: Draft["algorithm"];
  onChange: (id: Algorithm["id"] | null) => void;
  disabled: boolean;
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
          className={`algorithm-choice${value === item.id ? " algorithm-choice--checked" : ""}${disabled ? " algorithm-choice--disabled" : ""}`}
        >
          <label className="algorithm-choice-main" htmlFor={`algorithm-${item.id}`}>
            <input
              id={`algorithm-${item.id}`}
              type="radio"
              name="algorithm"
              checked={value === item.id}
              disabled={disabled}
              aria-label={item.name}
              aria-describedby={disabled ? "algorithm-prerequisite" : undefined}
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
