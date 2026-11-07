import { InfoTip } from "../InfoTip";
import {
  ALGORITHMS,
  TASK_TYPES,
  type Algorithm,
  type TaskType,
} from "../../domain/catalog";
import { type Draft } from "../../domain/config";
import { Choices, Field } from "../console";

/** 任务类型：列出已选算法支持的类型，由用户选；指标跟着任务类型走。最后留一个"待接入"的空位。 */
export function TaskTypeChoice({
  value,
  onChange,
  error,
}: {
  error?: string;
  algorithm: Algorithm | null;
  value: TaskType | null;
  onChange: (type: TaskType | null) => void;
}) {
  const types = Object.keys(TASK_TYPES).filter(type => TASK_TYPES[type].recordBased);
  return (
    <Field
      label="应用"
      labelId="task-type-label"
      wide
      error={error}
      info="选择要增强的应用，再选择提取和聚合经验的算法。"
    >

      {types.length ? (
        <Choices
          name="task-type"
          error={error}
          labelledBy="task-type-label"
          value={value}
          options={types.map((type) => ({ value: type, label: TASK_TYPES[type].label }))}
          placeholder="更多应用"
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
  value,
  onChange,
  error,
  taskType,
}: {
  taskType?: string | null;
  error?: string;
  value: Draft["algorithm"];
  onChange: (id: Algorithm["id"] | null) => void;
}) {
  const algorithms = ALGORITHMS.filter(a => a.accepts.some(type => TASK_TYPES[type]?.recordBased) && (!taskType || a.accepts.includes(taskType)));
  return (
    <Field label="算法" labelId="algorithm-label" wide error={error}>
      {!taskType ? <span id="algorithm-prerequisite" className="visually-hidden">先选择应用</span> : null}
      {algorithms.length ? (
        <AlgorithmTable error={error} algorithms={algorithms} value={value} onChange={onChange} disabled={!taskType} />
      ) : (
        <p className="field-static">还没有可用算法。</p>
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
