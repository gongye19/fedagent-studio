import { useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { formatSize } from "../domain/repository";
import { regressions } from "../domain/run";
import { LORA_FEDERATION_SCENARIO } from "../domain/scenario";
import { configurationSummary, isConfigurationReady, workloadOf } from "../domain/configuration";
import type { Artifact } from "../domain/types";
import { recipeOf, selectedArtifacts, type Action, type State } from "../state/store";
import RunBuilder from "./RunBuilder";
import { RunResults } from "./RunOverview";
import type { FlowStepId } from "./flow";

type Props = {
  activeStep: FlowStepId;
  state: State;
  dispatch: (action: Action) => void;
  onNext: () => void;
  onBack: () => void;
  onReset: () => void;
};

const STATUS_LABEL = {
  pending: "Pending",
  running: "Running",
  done: "Complete",
  skipped: "Skipped",
  failed: "Failed",
} as const;

type ExecutionStep = "provision" | "federate" | "evaluate";

function stageCopy(
  step: ExecutionStep,
  summary: ReturnType<typeof configurationSummary>,
  inputCount: number,
) {
  if (step === "provision") {
    return {
      title: "Provision sandbox",
      idle: `The platform will provision the ${summary.runner} runner after preflight.`,
      facts: [
        ["Runner", summary.runner],
        ["Isolation", "Ephemeral sandbox"],
        ["Network", "Deny by default"],
        ["Artifact", summary.artifact],
      ] as const,
    };
  }
  if (step === "federate") {
    return {
      title: `Execute ${summary.strategy}`,
      idle: `The frontend demo will simulate ${summary.strategy} with ${inputCount} participant inputs.`,
      facts: [
        ["Inputs", `${inputCount} participant inputs`],
        ["Strategy", summary.strategy],
        ["Protection", summary.protection],
        ["Output", summary.output],
      ] as const,
    };
  }
  return {
    title: "Evaluate output",
    idle: "The output must pass the selected evaluation gate before publication.",
    facts: [
      ["Artifact", summary.artifact],
      ["Evaluation", summary.evaluation],
      ["Runner", summary.runner],
      ["Release gate", "Required"],
    ] as const,
  };
}

export default function RunStepContent({
  activeStep, state, dispatch, onNext, onBack, onReset,
}: Props) {
  const ready = isConfigurationReady(state.configuration) && Boolean(recipeOf(state));
  const selected = selectedArtifacts(state);
  const summary = configurationSummary(state.configuration);

  if (activeStep === "configure") {
    return (
      <StepFrame title="Configuration" status={ready ? "Ready" : "Needs input"}>
        <RunBuilder state={state} dispatch={dispatch} />
        <StepActions onNext={onNext} nextLabel="Continue" nextDisabled={!ready} />
      </StepFrame>
    );
  }

  if (activeStep === "upload") {
    return (
      <StepFrame title="Data upload" status={`${selected.length} inputs`}>
        <DataUpload state={state} dispatch={dispatch} />
        <StepActions
          onBack={onBack}
          onNext={onNext}
          nextLabel="Continue"
          nextDisabled={selected.length < LORA_FEDERATION_SCENARIO.inputContract.minParticipants}
        />
      </StepFrame>
    );
  }

  if (activeStep === "preflight") {
    return (
      <StepFrame title="Agent preflight" status={ready ? "Compatible" : "Waiting"} statusTone={ready ? "complete" : undefined}>
        <Preflight state={state} />
        <StepActions onBack={onBack} onNext={onNext} nextLabel="Create sandbox" nextDisabled={!ready} />
      </StepFrame>
    );
  }

  if (activeStep === "publish") {
    const dropped = state.run?.result ? regressions(state.run.result.comparison) : [];
    const publishStatus = state.run?.result
      ? dropped.length ? `${dropped.length} regressions` : "Evaluation passed"
      : state.run ? "Running" : "Pending";
    return (
      <StepFrame
        title="Publish artifact"
        status={publishStatus}
        statusTone={state.run?.result ? dropped.length ? "failed" : "complete" : state.run ? "running" : undefined}
      >
        {state.run?.result ? (
          <RunResults state={state} embedded />
        ) : (
          <StageMessage text="The artifact will be available after evaluation and lineage registration finish." />
        )}
        <StepActions onBack={onBack} onReset={state.run?.result ? onReset : undefined} />
      </StepFrame>
    );
  }

  const copy = stageCopy(activeStep, summary, selected.length);
  const stage = state.run?.stages.find((item) => item.id === activeStep);
  const status = stage ? STATUS_LABEL[stage.status] : "Pending";
  const tone = stage?.status === "done" ? "complete" : stage?.status === "running" ? "running" : stage?.status === "failed" ? "failed" : undefined;
  const stageMessage = state.configuration.workloadId === "peft"
    ? stage?.detail || copy.idle
    : stage?.status === "done"
      ? `${copy.title} completed in frontend simulation.`
      : copy.idle;

  return (
    <StepFrame title={copy.title} status={status} statusTone={tone}>
      <ExecutionStage
        facts={copy.facts}
        message={stageMessage}
        running={stage?.status === "running"}
      />
      <StepActions onBack={onBack} onNext={onNext} nextLabel={activeStep === "evaluate" ? "View publication" : "Continue"} />
    </StepFrame>
  );
}

function StepFrame({
  title, status, statusTone, children,
}: {
  title: string;
  status: string;
  statusTone?: "complete" | "running" | "failed";
  children: ReactNode;
}) {
  return (
    <section className="step-content" aria-labelledby="step-title">
      <header className="step-header">
        <h2 id="step-title">{title}</h2>
        <span className={`status${statusTone ? ` status--${statusTone}` : ""}`}>{status}</span>
      </header>
      <div className="step-body">{children}</div>
    </section>
  );
}

function DataUpload({ state, dispatch }: { state: State; dispatch: (action: Action) => void }) {
  const selected = selectedArtifacts(state);
  const workload = workloadOf(state.configuration.workloadId);
  const model = LORA_FEDERATION_SCENARIO.baseModelOptions.find((item) => item.id === state.baseModelId);
  const rank = LORA_FEDERATION_SCENARIO.rankOptions.find((item) => item.id === state.rankId);
  const uploaded = state.artifacts.filter((artifact) => (
    artifact.owner === "me"
    && artifact.id.startsWith("upload-")
    && state.artifactIds.includes(artifact.id)
  ));
  const rows = state.configuration.workloadId === "peft"
    ? selected.map((artifact) => ({
        id: artifact.id,
        name: artifact.name,
        source: artifact.provenance,
        size: formatSize(artifact.sizeBytes),
        removable: true,
      }))
    : [
        ...sampleInputs(state.configuration.workloadId),
        ...uploaded.map((artifact) => ({
          id: artifact.id,
          name: artifact.name,
          source: "Local upload",
          size: formatSize(artifact.sizeBytes),
          removable: true,
        })),
      ];

  function stageFiles(files: FileList | null) {
    if (!files || !model || !rank) return;
    for (const file of Array.from(files)) {
      const idPart = file.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "adapter";
      const artifact: Artifact = {
        id: `upload-${idPart}-${file.lastModified}`,
        name: file.name.replace(/\.(safetensors|zip|bin)$/i, ""),
        objectType: "lora",
        domain: "上传",
        architecture: model.architecture,
        baseCheckpoint: model.checkpoint,
        rank: rank.value,
        provenance: "Local upload",
        trainingMethod: "Pending manifest extraction",
        sizeBytes: file.size,
        createdAt: new Date().toISOString().slice(0, 10),
        metrics: selected[0]?.metrics ?? {},
        owner: "me",
      };
      dispatch({ type: "stageArtifact", artifact });
    }
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    stageFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    stageFiles(event.dataTransfer.files);
  }

  return (
    <div className="upload-workspace">
      <label className="upload-zone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <input type="file" multiple accept={workload.inputAccept} onChange={handleInput} />
        <strong>Drop {workload.inputLabel} here</strong>
        <span>Choose files</span>
      </label>

      <div className="upload-list" aria-live="polite">
        {rows.map((row) => (
          <div className="upload-row" key={row.id}>
            <div>
              <strong>{row.name}</strong>
              <span>{row.source}</span>
            </div>
            <span className="upload-size">{row.size}</span>
            {row.removable ? (
              <button
                type="button"
                className="remove-button"
                aria-label={`移除 ${row.name}`}
                onClick={() => dispatch({ type: "toggleArtifact", id: row.id })}
              >
                Remove
              </button>
            ) : <span className="input-ready">Ready</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

const SAMPLE_INPUTS: Record<string, readonly string[]> = {
  "model-training": ["Participant A training package", "Participant B training package", "Participant C training package"],
  "vertical-modeling": ["Guest data contract", "Host data contract", "PSI key manifest"],
  "federated-evaluation": ["Candidate model manifest", "Site evaluation contract", "Metric schema"],
  "federated-analytics": ["Site A analytics schema", "Site B analytics schema", "Aggregate policy"],
  fedrag: ["Hospital knowledge index", "Research knowledge index", "Retrieval policy"],
  personalized: ["Shared backbone", "Participant A local head", "Participant B local head"],
  "heterogeneous-models": ["Client model A contract", "Client model B contract", "Calibration set manifest"],
  "agent-skill": ["Research skill package", "Operations skill package", "Sandbox evaluation contract"],
};

function sampleInputs(workloadId: string) {
  return (SAMPLE_INPUTS[workloadId] ?? SAMPLE_INPUTS["model-training"]).map((name, index) => ({
    id: `sample-${workloadId}-${index}`,
    name,
    source: "Demo participant",
    size: "Connected",
    removable: false,
  }));
}

function Preflight({ state }: { state: State }) {
  const [showRejection, setShowRejection] = useState(false);
  const ready = isConfigurationReady(state.configuration) && Boolean(recipeOf(state));
  const summary = configurationSummary(state.configuration);

  return (
    <div className="preflight-workspace">
      {ready ? (
        <ul className="check-list" aria-label="准入检查结果">
          <li><span aria-hidden="true">✓</span><strong>Data contract</strong><b>{summary.partition}</b></li>
          <li><span aria-hidden="true">✓</span><strong>Strategy</strong><b>{summary.strategy}</b></li>
          <li><span aria-hidden="true">✓</span><strong>Protection</strong><b>{summary.protection}</b></li>
          <li><span aria-hidden="true">✓</span><strong>Runtime</strong><b>{summary.runner}</b></li>
        </ul>
      ) : (
        <StageMessage text="Complete every configuration dimension and connect at least two participant inputs." />
      )}

      <button type="button" className="text-button" aria-expanded={showRejection} onClick={() => setShowRejection((value) => !value)}>
        {showRejection ? "Hide sample rejection" : "View sample rejection"}
      </button>

      {showRejection ? (
        <div className="rejection-example">
          <strong>Participant B did not pass preflight</strong>
          <p>The uploaded contract is incompatible with {summary.strategy}. The agent recommends a compatible schema or a different strategy.</p>
        </div>
      ) : null}
    </div>
  );
}

function ExecutionStage({
  facts, message, running,
}: {
  facts: readonly (readonly [string, string])[];
  message: string;
  running: boolean;
}) {
  return (
    <div className="execution-workspace">
      <StageMessage text={message} running={running} />
      <dl className="stage-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StageMessage({ text, running = false }: { text: string; running?: boolean }) {
  return (
    <div className={`stage-message${running ? " stage-message--running" : ""}`} aria-live="polite">
      {running ? <span aria-hidden="true" /> : null}
      <p>{text}</p>
    </div>
  );
}

function StepActions({
  onBack, onNext, onReset, nextLabel, nextDisabled = false,
}: {
  onBack?: () => void;
  onNext?: () => void;
  onReset?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <footer className="step-actions">
      <div>{onBack ? <button type="button" className="button button--secondary" onClick={onBack}>Back</button> : null}</div>
      {onNext ? <button type="button" className="button button--primary" disabled={nextDisabled} onClick={onNext}>{nextLabel ?? "Continue"}</button> : null}
      {onReset ? <button type="button" className="button button--primary" onClick={onReset}>New run</button> : null}
    </footer>
  );
}
