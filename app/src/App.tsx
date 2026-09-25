import { useReducer, useState } from "react";
import { buildRunPlan } from "./domain/plan";
import { isComplete, scenarioFor } from "./domain/selection";
import { stageOf } from "./domain/run";
import { initialState, inputStatus, reducer } from "./state/store";
import { useRunSimulation } from "./state/useRunSimulation";
import { StepActions, StepFrame, type Tone } from "./ui/common";
import ConfigurationStep from "./ui/ConfigurationStep";
import { FLOW_STEPS, isRunStage, nextFlowStep, previousFlowStep, type FlowStepId } from "./ui/flow";
import InputsStep from "./ui/InputsStep";
import { STATUS_LABEL, participantsLabel, stepStates } from "./ui/progress";
import PublishStep from "./ui/PublishStep";
import RunPanel from "./ui/RunPanel";
import StageStep from "./ui/StageStep";

const STAGE_TONE: Record<string, Tone | undefined> = {
  pending: undefined,
  running: "running",
  done: "complete",
  failed: "failed",
};

const labelOf = (id: FlowStepId | null) => FLOW_STEPS.find((step) => step.id === id)?.label ?? "";

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [activeStep, setActiveStep] = useState<FlowStepId>("configure");
  useRunSimulation(state.run, dispatch);

  const { run, selection } = state;
  const plan = run?.plan ?? buildRunPlan(selection);
  const configured = isComplete(selection);
  const status = inputStatus(state, plan);
  const inputsReady = Boolean(run) || status.ready;
  const scenario = scenarioFor(selection);
  const steps = stepStates(state, inputsReady, status.count);
  const stepIndex = FLOW_STEPS.findIndex((step) => step.id === activeStep);
  const stepLabel = labelOf(activeStep);
  const nextLabel = `下一步：${labelOf(nextFlowStep(activeStep))}`;

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
      return (
        <StepFrame title={stepLabel} status={run ? "已锁定" : configured ? "已就绪" : "待完成"} statusTone={configured ? "complete" : undefined}>
          <ConfigurationStep selection={selection} locked={Boolean(run)} dispatch={dispatch} />
          <StepActions onNext={goNext} nextLabel={nextLabel} nextDisabled={!configured} />
        </StepFrame>
      );
    }
    if (activeStep === "inputs") {
      return (
        <StepFrame title={stepLabel} status={participantsLabel(state, status.count)} statusTone={inputsReady ? "complete" : undefined}>
          <InputsStep state={state} plan={plan} dispatch={dispatch} />
          <StepActions onBack={goBack} onNext={goNext} nextLabel={run ? nextLabel : "开始准入检查"} nextDisabled={!inputsReady} />
        </StepFrame>
      );
    }
    if (activeStep === "publish") {
      const item = steps.publish;
      return (
        <StepFrame title={stepLabel} status={run?.error ? STATUS_LABEL.failed : item.label} statusTone={run?.error ? "failed" : STAGE_TONE[item.state]}>
          <PublishStep run={run} dispatch={dispatch} />
          <StepActions onBack={goBack} onReset={run ? newRun : undefined} />
        </StepFrame>
      );
    }
    if (isRunStage(activeStep)) {
      const stage = run ? stageOf(run, activeStep) : undefined;
      const value = stage?.status ?? "pending";
      return (
        <StepFrame title={stepLabel} status={STATUS_LABEL[value]} statusTone={STAGE_TONE[value]}>
          <StageStep stageId={activeStep} run={run} />
          <StepActions onBack={goBack} onNext={goNext} onReset={run?.error ? newRun : undefined} nextLabel={nextLabel} />
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
            <span>联邦协作</span>
            <i aria-hidden="true">/</i>
            <strong>新建运行</strong>
          </div>
          <span className="environment" title="所有执行都是前端模拟，后端未接入">模拟环境</span>
        </div>
      </header>

      <main className="page" id="main">
        <header className="page-head">
          <h1>新建联邦运行</h1>
          <span className="draft-id" translate="no">{run?.id ?? scenario?.id ?? "draft"}</span>
        </header>

        <nav className="mobile-progress" aria-label="运行进度">
          <p>
            <strong>第 {stepIndex + 1} / {FLOW_STEPS.length} 步</strong>
            <span>{stepLabel} · {steps[activeStep].label}</span>
          </p>
          <ol aria-hidden="true">
            {FLOW_STEPS.map((step) => (
              <li
                key={step.id}
                className={`mobile-progress-segment mobile-progress-segment--${steps[step.id].state}${step.id === activeStep ? " mobile-progress-segment--current" : ""}`}
              />
            ))}
          </ol>
        </nav>

        <div className="run-workspace">
          {content()}
          <RunPanel state={state} inputsReady={inputsReady} datasets={status.count} activeStep={activeStep} onSelectStep={setActiveStep} />
        </div>
      </main>
    </div>
  );
}
