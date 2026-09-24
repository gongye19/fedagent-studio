import { OBJECT_TYPE_LABEL } from "../domain/compatibility";
import { methodOf, privacyOf } from "../domain/registry";
import { formatSize } from "../domain/repository";
import { canDownload, deltaPoints, regressions, type StageStatus } from "../domain/run";
import { configurationSummary, isConfigurationReady } from "../domain/configuration";
import { recipeOf, selectedArtifacts, type State } from "../state/store";
import { FLOW_STEPS, isRunStage, type FlowStepId } from "./flow";

type OverviewProps = {
  state: State;
  activeStep: FlowStepId;
  onSelectStep: (step: FlowStepId) => void;
};

const STATUS_LABEL: Record<StageStatus, string> = {
  pending: "Pending",
  running: "Running",
  done: "Complete",
  skipped: "Skipped",
  failed: "Failed",
};

export default function RunOverview({ state, activeStep, onSelectStep }: OverviewProps) {
  const selected = selectedArtifacts(state);
  const run = state.run;
  const ready = isConfigurationReady(state.configuration) && Boolean(recipeOf(state));
  const running = Boolean(run && !run.result && !run.error);
  const status = run?.result ? "Complete" : run?.error ? "Failed" : running ? "Running" : ready ? "Ready" : "Draft";

  function stepStatus(id: FlowStepId): { state: StageStatus; label: string } {
    if (id === "configure") return { state: ready ? "done" : "pending", label: ready ? "Ready" : "Needs input" };
    if (id === "upload") {
      const done = selected.length >= 2;
      return { state: done ? "done" : "pending", label: done ? `${selected.length} inputs` : "Waiting" };
    }
    const stage = isRunStage(id) ? run?.stages.find((item) => item.id === id) : undefined;
    return { state: stage?.status ?? "pending", label: STATUS_LABEL[stage?.status ?? "pending"] };
  }

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
    </aside>
  );
}

export function RunResults({ state, embedded = false }: { state: State; embedded?: boolean }) {
  const run = state.run;
  const summary = configurationSummary(state.configuration);
  if (!run?.result) return null;

  if (state.configuration.workloadId !== "peft") {
    return (
      <section
        className={`run-results${embedded ? " run-results--embedded" : ""}`}
        aria-label="Frontend simulation output"
      >
        {!embedded ? (
          <header className="results-head">
            <h2>Run output</h2>
            <span className="status status--complete">Frontend flow complete</span>
          </header>
        ) : null}
        <div className="preview-output">
          <dl className="stage-facts">
            <div><dt>Workload</dt><dd>{summary.workload}</dd></div>
            <div><dt>Strategy</dt><dd>{summary.strategy}</dd></div>
            <div><dt>Runner</dt><dd>{summary.runner}</dd></div>
            <div><dt>Output</dt><dd>{summary.output}</dd></div>
          </dl>
          <button type="button" className="button button--primary" disabled>Backend not connected</button>
        </div>
      </section>
    );
  }

  const selected = selectedArtifacts(state);
  const method = state.methodId ? methodOf(state.methodId) : undefined;
  const privacy = state.privacyId ? privacyOf(state.privacyId) : undefined;
  if (!selected[0] || !method || !privacy) return null;

  const dropped = regressions(run.result.comparison);

  return (
    <section
      className={`run-results${embedded ? " run-results--embedded" : ""}`}
      aria-labelledby={embedded ? undefined : "results-title"}
      aria-label={embedded ? "Run output" : undefined}
    >
      {!embedded ? (
        <header className="results-head">
          <h2 id="results-title">Run output</h2>
          <span className={`status${dropped.length ? " status--failed" : " status--complete"}`}>
            {dropped.length ? `${dropped.length} regressions` : "Evaluation passed"}
          </span>
        </header>
      ) : null}

      <div className="results-body">
        <div className="metrics-table-wrap">
          <table className="metrics-table">
            <thead>
              <tr><th>Metric</th><th>Baseline</th><th>Output</th><th>Delta</th></tr>
            </thead>
            <tbody>
              {run.result.comparison.map((row) => {
                const delta = deltaPoints(row);
                return (
                  <tr key={row.metric} className={delta < 0 ? "metric-down" : ""}>
                    <td>
                      <strong>{row.metric}</strong>
                      <small>{row.sources.map((source) => `${source.artifactName} ${percent(source.value)}`).join(" / ")}</small>
                    </td>
                    <td>{percent(row.before)}</td>
                    <td>{percent(row.after)}</td>
                    <td>{delta > 0 ? "+" : ""}{delta}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="output-summary">
          <div>
            <span className="output-label">Artifact</span>
            <h3>{run.result.name}</h3>
          </div>
          <dl>
            <div><dt>Type</dt><dd>{summary.artifact ?? OBJECT_TYPE_LABEL[selected[0].objectType]}</dd></div>
            <div><dt>Size</dt><dd>{formatSize(run.result.sizeBytes)}</dd></div>
            <div><dt>Workload</dt><dd>{summary.workload}</dd></div>
            <div><dt>Strategy</dt><dd>{summary.strategy ?? method.name}</dd></div>
            <div><dt>Protection</dt><dd>{summary.protection ?? privacy.name}</dd></div>
          </dl>
          <button type="button" className="button button--primary" disabled={!canDownload(run)}>Download</button>
        </div>
      </div>
    </section>
  );
}

const percent = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  maximumFractionDigits: 0,
}).format;
