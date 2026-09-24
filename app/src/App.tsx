import { useReducer, useState } from "react";
import { buildRunPlan } from "./domain/plan";
import { isComplete, scenarioFor, visibleLayers } from "./domain/selection";
import { stageOf } from "./domain/run";
import { initialState, reducer } from "./state/store";
import { useRunSimulation } from "./state/useRunSimulation";
import { StepActions, StepFrame, type Tone } from "./ui/common";
import ConfigurationStep from "./ui/ConfigurationStep";
import { FLOW_STEPS, isRunStage, nextFlowStep, previousFlowStep, type FlowStepId } from "./ui/flow";
import InputsStep from "./ui/InputsStep";
import PublishStep from "./ui/PublishStep";
import RunPanel from "./ui/RunPanel";
import StageStep from "./ui/StageStep";

const STAGE_STATUS: Record<string, [string, Tone | undefined]> = {
  pending: ["Pending", undefined],
  running: ["Running", "running"],
  done: ["Complete", "complete"],
  failed: ["Failed", "failed"],
};

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [activeStep, setActiveStep] = useState<FlowStepId>("configure");
  useRunSimulation(state.run, dispatch);

  const { run, selection } = state;
  const plan = run?.plan ?? buildRunPlan(selection);
  const configured = isComplete(selection);
  const participants = run?.participants ?? state.participants;
  const inputsReady = Boolean(plan && participants.length >= plan.minParticipants);
  const scenario = scenarioFor(selection);
  const stepLabel = FLOW_STEPS.find((step) => step.id === activeStep)?.label ?? "";

  function goNext() {
    if (activeStep === "inputs" && !run) {
      dispatch({ type: "startRun", id: `run-${Date.now()}`, createdAt: new Date().toISOString() });
    }
    const next = nextFlowStep(activeStep);
    if (next) setActiveStep(next);
  }

  function goBack() {
    const previous = previousFlowStep(activeStep);
    if (previous) setActiveStep(previous);
  }

  function newRun() {
    dispatch({ type: "reset" });
    setActiveStep("configure");
  }

  function content() {
    if (activeStep === "configure") {
      const answered = visibleLayers(selection).filter((layer) => selection[layer.id]).length;
      return (
        <StepFrame title={stepLabel} status={run ? "Locked" : configured ? "Ready" : `${answered} selected`} statusTone={configured ? "complete" : undefined}>
          <ConfigurationStep selection={selection} locked={Boolean(run)} dispatch={dispatch} />
          <StepActions onNext={goNext} nextLabel="Continue" nextDisabled={!configured} />
        </StepFrame>
      );
    }
    if (activeStep === "inputs") {
      return (
        <StepFrame title={stepLabel} status={`${participants.length} participants`} statusTone={inputsReady ? "complete" : undefined}>
          <InputsStep state={state} plan={plan} dispatch={dispatch} />
          <StepActions onBack={goBack} onNext={goNext} nextLabel={run ? "Continue" : "开始准入检查"} nextDisabled={!inputsReady} />
        </StepFrame>
      );
    }
    if (activeStep === "publish") {
      const stage = run ? stageOf(run, "publish") : undefined;
      const [status, tone] = run?.error ? STAGE_STATUS.failed : STAGE_STATUS[stage?.status ?? "pending"];
      return (
        <StepFrame title={stepLabel} status={status} statusTone={tone}>
          <PublishStep run={run} dispatch={dispatch} />
          <StepActions onBack={goBack} onReset={run ? newRun : undefined} />
        </StepFrame>
      );
    }
    if (isRunStage(activeStep)) {
      const stage = run ? stageOf(run, activeStep) : undefined;
      const [status, tone] = STAGE_STATUS[stage?.status ?? "pending"];
      return (
        <StepFrame title={stepLabel} status={status} statusTone={tone}>
          <StageStep stageId={activeStep} run={run} />
          <StepActions onBack={goBack} onNext={goNext} onReset={run?.error ? newRun : undefined} nextLabel="Continue" />
        </StepFrame>
      );
    }
    return null;
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">跳到主要内容</a>
      <header className="navbar">
        <div className="nav-inner">
          <a className="wordmark" href="/" aria-label="Federation Studio 首页">
            <span aria-hidden="true">F</span>
            <strong>Federation Studio</strong>
          </a>
          <div className="breadcrumbs" aria-label="当前位置">
            <span>Federation</span>
            <i aria-hidden="true">/</i>
            <strong>New run</strong>
          </div>
          <span className="environment" title="所有执行都是前端模拟，后端未接入">Simulation</span>
        </div>
      </header>

      <main className="page" id="main">
        <header className="page-head">
          <h1>Create a federation run</h1>
          <span className="draft-id" translate="no">{run?.id ?? scenario?.id ?? "draft"}</span>
        </header>

        <div className="run-workspace">
          {content()}
          <RunPanel state={state} minParticipants={plan?.minParticipants ?? null} activeStep={activeStep} onSelectStep={setActiveStep} />
        </div>
      </main>
    </div>
  );
}
