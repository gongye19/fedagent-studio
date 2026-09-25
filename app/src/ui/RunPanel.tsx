import { planPreview } from "../domain/plan";
import type { State } from "../state/store";
import { FLOW_STEPS, type FlowStepId } from "./flow";
import { Icon } from "./icons";
import { RUN_STATUS_LABEL, runStatus, stepStates } from "./progress";

type Props = {
  state: State;
  inputsReady: boolean;
  datasets: number;
  activeStep: FlowStepId;
  onSelectStep: (step: FlowStepId) => void;
};

export default function RunPanel({ state, inputsReady, datasets, activeStep, onSelectStep }: Props) {
  const status = runStatus(state);
  const steps = stepStates(state, inputsReady, datasets);
  const preview = planPreview(state.selection);

  const derived: [string, string | undefined][] = [
    ["执行模式", preview.pattern],
    ["联邦对象", preview.exchanged],
    ["计算类型", preview.computeKind],
    ["Runner", preview.runner],
    ["安全机制", preview.mechanisms?.join(" · ")],
  ];

  return (
    <aside className="run-panel" aria-labelledby="run-plan-title">
      <header className="run-panel-head">
        <h2 id="run-plan-title">运行计划</h2>
        <span className={`status status--${status}`}>{RUN_STATUS_LABEL[status]}</span>
      </header>

      <ol className="run-timeline" aria-label="运行步骤">
        {FLOW_STEPS.map((step) => {
          const item = steps[step.id];
          const current = activeStep === step.id;
          return (
            <li className={`timeline-item timeline-item--${item.state}${current ? " timeline-item--current" : ""}`} key={step.id}>
              <button type="button" aria-current={current ? "step" : undefined} onClick={() => onSelectStep(step.id)}>
                <span className="timeline-mark" aria-hidden="true">
                  {item.state === "done" ? <Icon name="check" /> : item.state === "failed" ? <Icon name="x" /> : null}
                </span>
                <span className="timeline-copy">
                  <strong>{step.label}</strong>
                  <small>{item.label}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <section className="derived" aria-labelledby="derived-title">
        <h3 id="derived-title">平台推导</h3>
        <p className="derived-scenario">{preview.scenario ?? "选择场景后显示"}</p>
        <dl>
          {derived.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </section>
    </aside>
  );
}
