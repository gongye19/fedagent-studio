import { planPreview } from "../domain/plan";
import { isComplete } from "../domain/selection";
import { stageOf, type StageStatus } from "../domain/run";
import type { State } from "../state/store";
import { FLOW_STEPS, isRunStage, type FlowStepId } from "./flow";

type Props = {
  state: State;
  minParticipants: number | null;
  activeStep: FlowStepId;
  onSelectStep: (step: FlowStepId) => void;
};

const STATUS_LABEL: Record<StageStatus, string> = {
  pending: "Pending",
  running: "Running",
  done: "Complete",
  failed: "Failed",
};

export default function RunPanel({ state, minParticipants, activeStep, onSelectStep }: Props) {
  const { run } = state;
  const configured = isComplete(state.selection);
  const published = run ? stageOf(run, "publish").status === "done" : false;
  const status = run?.error ? "Failed" : published ? "Complete" : run ? "Running" : configured ? "Ready" : "Draft";
  const preview = planPreview(state.selection);
  const participants = run?.participants.length ?? state.participants.length;

  function stepStatus(id: FlowStepId): { state: StageStatus; label: string } {
    if (id === "configure") return configured ? { state: "done", label: "Ready" } : { state: "pending", label: "Needs input" };
    if (id === "inputs") {
      const done = configured && minParticipants !== null && participants >= minParticipants;
      return { state: done ? "done" : "pending", label: configured ? `${participants} participants` : "Waiting" };
    }
    const stage = run && isRunStage(id) ? stageOf(run, id) : undefined;
    const value = stage?.status ?? "pending";
    return { state: value, label: id === "publish" && value === "pending" && run?.evaluation?.passed ? "Awaiting confirm" : STATUS_LABEL[value] };
  }

  const derived: [string, string | undefined][] = [
    ["执行模式", preview.pattern],
    ["联邦对象", preview.exchanged],
    ["计算类型", preview.computeKind],
    ["Runner", preview.runner],
    ["保护机制", preview.mechanisms?.join(" · ")],
  ];

  return (
    <aside className="run-panel" aria-labelledby="run-plan-title">
      <header className="run-panel-head">
        <h2 id="run-plan-title">Run plan</h2>
        <span className={`status status--${status.toLowerCase()}`}>{status}</span>
      </header>

      <ol className="run-timeline" aria-label="联邦运行阶段">
        {FLOW_STEPS.map((step) => {
          const item = stepStatus(step.id);
          const current = activeStep === step.id;
          return (
            <li className={`timeline-item timeline-item--${item.state}${current ? " timeline-item--current" : ""}`} key={step.id}>
              <button type="button" aria-current={current ? "step" : undefined} onClick={() => onSelectStep(step.id)}>
                <span className="timeline-mark" aria-hidden="true">{item.state === "done" ? "✓" : ""}</span>
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
        <header className="derived-head">
          <h3 id="derived-title">平台推导</h3>
        </header>
        <p className="derived-scenario">{preview.scenario ?? "确定场景后显示"}</p>
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
