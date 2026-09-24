import { useEffect, useReducer, useRef, useState } from "react";
import { backendFor, type Context } from "./domain/backends";
import { evaluationOf, methodOf, privacyOf } from "./domain/registry";
import { METRIC_KEYS } from "./domain/repository";
import { buildComparison, createRun, nextStage } from "./domain/run";
import { workloadOf } from "./domain/configuration";
import type { Artifact } from "./domain/types";
import {
  initialState, recipeOf, reducer, selectedArtifacts,
} from "./state/store";
import RunOverview from "./ui/RunOverview";
import RunStepContent from "./ui/RunStepContent";
import { isRunStage, nextFlowStep, previousFlowStep, type FlowStepId } from "./ui/flow";

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [activeStep, setActiveStep] = useState<FlowStepId>("configure");
  // StrictMode 下 effect 会跑两次，没有这道闸会把产物写两份。
  const produced = useRef(new Set<string>());

  const { run } = state;
  const workload = workloadOf(state.configuration.workloadId);

  function start() {
    const recipe = recipeOf(state);
    if (!recipe) return;
    dispatch({ type: "startRun", run: createRun(`run-${Date.now()}`, recipe, new Date().toISOString()) });
  }

  function goNext() {
    if (isRunStage(activeStep) && !state.run) start();
    const next = nextFlowStep(activeStep);
    if (next) setActiveStep(next);
  }

  function goBack() {
    const previous = previousFlowStep(activeStep);
    if (previous) setActiveStep(previous);
  }

  function resetRun() {
    produced.current.clear();
    dispatch({ type: "reset" });
    setActiveStep("configure");
  }

  useEffect(() => {
    if (!run || run.error || run.result) return;

    const selected = selectedArtifacts(state);
    const method = methodOf(run.recipe.methodId);
    const privacy = privacyOf(run.recipe.privacyId);
    const evaluation = evaluationOf(run.recipe.evaluationId);
    if (!method || !privacy || !evaluation || selected.length < 2) return;

    const context: Context = {
      selected, method, privacy,
      evaluation,
      datasetName: null,
    };
    const backend = backendFor(method);

    // 有阶段在跑：等它的演示时长走完再推进。
    const running = run.stages.find((stage) => stage.status === "running");
    if (running) {
      const work = backend.plan(running.id, context);
      const timer = setTimeout(() => {
        dispatch({ type: "stageFinish", stage: running.id, detail: work.detail });
      }, work.demoMs);
      return () => clearTimeout(timer);
    }

    // 还有阶段没跑：开下一个。阶段顺序由 L3 决定，这里不做判断。
    const pending = nextStage(run);
    if (pending) {
      dispatch({ type: "stageStart", stage: pending.id });
      return;
    }

    if (produced.current.has(run.id)) return;
    produced.current.add(run.id);

    const result = backend.produce(context);
    const base = selected[0];
    const artifactId = `produced-${run.id}`;
    const artifact: Artifact = {
      id: artifactId,
      name: result.name,
      objectType: base.objectType,
      domain: [...new Set(selected.map((item) => item.domain))].join("+"),
      architecture: base.architecture,
      baseCheckpoint: base.baseCheckpoint,
      rank: base.rank,
      provenance: "本平台合并产出",
      trainingMethod: `由 ${selected.length} 项按「${method.name}」合并`,
      sizeBytes: result.sizeBytes,
      createdAt: new Date().toISOString().slice(0, 10),
      metrics: result.metrics,
      owner: "me",
      lineage: selected.map((item) => item.id),
    };

    dispatch({
      type: "runResult",
      artifact,
      result: {
        artifactId,
        name: result.name,
        sizeBytes: result.sizeBytes,
        metrics: result.metrics,
        comparison: buildComparison(selected, METRIC_KEYS[base.objectType], result.metrics),
      },
    });
  }, [run, state]);

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
          <span className="environment">Demo</span>
        </div>
      </header>

      <main className="page" id="main">
        <header className="page-head">
          <h1>Create a federation run</h1>
          <span className="draft-id" translate="no">{workload.id}</span>
        </header>

        <div className="run-workspace">
          <RunStepContent
            activeStep={activeStep}
            state={state}
            dispatch={dispatch}
            onNext={goNext}
            onBack={goBack}
            onReset={resetRun}
          />
          <RunOverview state={state} activeStep={activeStep} onSelectStep={setActiveStep} />
        </div>
      </main>
    </div>
  );
}
