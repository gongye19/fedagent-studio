import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultParticipants } from "./demo";
import { buildRunPlan, type FrontendRunPlan } from "./plan";
import {
  canPublish,
  createRun,
  finishStage,
  isFinished,
  nextAutoStage,
  progressOf,
  publishRun,
  stageOf,
  startStage,
  type Run,
  type StageId,
} from "./run";
import { applyTemplate, choose } from "./selection";
import { artifactFor, stageWork } from "./simulator";

function planFor(): FrontendRunPlan {
  const selection = choose(choose(applyTemplate("peft-finetune"), "strategy", "peft-fedavg"), "protection", "standard");
  const plan = buildRunPlan(selection);
  if (!plan) throw new Error("plan expected");
  return plan;
}

function advance(run: Run, stage: Exclude<StageId, "publish">): Run {
  const started = startStage(run, stage);
  return finishStage(started, stage, stageWork(stage, started.plan, started.participants, started.preset));
}

function newRun(): Run {
  return createRun("run-1", planFor(), defaultParticipants("peft-finetune", "local-data"), "quick", "2026-09-24T00:00:00Z");
}

describe("run lifecycle", () => {
  it("runs the automatic stages in order and waits for a manual publish", () => {
    let run = newRun();
    const order: StageId[] = [];
    let next = nextAutoStage(run);
    while (next) {
      order.push(next);
      run = advance(run, next as Exclude<StageId, "publish">);
      next = nextAutoStage(run);
    }
    expect(order).toEqual(["preflight", "provision", "execute", "evaluate"]);
    expect(stageOf(run, "publish").status).toBe("pending");
    expect(canPublish(run)).toBe(true);
    expect(isFinished(run)).toBe(false);

    const published = publishRun(run, artifactFor(run.plan, run.participants, run.id, "participants"));
    expect(stageOf(published, "publish").status).toBe("done");
    expect(published.artifact?.lineage).toHaveLength(3);
    expect(isFinished(published)).toBe(true);
    expect(progressOf(published)).toBe(1);
  });

  it("refuses to skip stages", () => {
    const run = newRun();
    expect(startStage(run, "execute")).toBe(run);
    expect(startStage(run, "publish")).toBe(run);
    expect(finishStage(run, "preflight", { detail: "", realCost: "", logs: [] })).toBe(run);
  });

  it("ignores a duplicate start of a running stage", () => {
    const running = startStage(newRun(), "preflight");
    expect(startStage(running, "preflight")).toBe(running);
    expect(nextAutoStage(running)).toBeNull();
  });

  it("stops the run when preflight rejects the inputs", () => {
    const run = createRun("run-2", planFor(), defaultParticipants("peft-finetune", "local-data").slice(0, 1), "quick", "2026-09-24T00:00:00Z");
    const checked = advance(run, "preflight");
    expect(checked.preflight?.passed).toBe(false);
    expect(stageOf(checked, "preflight").status).toBe("failed");
    expect(checked.error).toContain("准入");
    expect(nextAutoStage(checked)).toBeNull();
  });

  it("blocks publication when evaluation fails the gate", () => {
    let run = newRun();
    for (const stage of ["preflight", "provision", "execute"] as const) run = advance(run, stage);
    const started = startStage(run, "evaluate");
    const failed = finishStage(started, "evaluate", {
      detail: "",
      realCost: "",
      logs: [],
      evaluation: { passed: false, metrics: [] },
    });
    expect(failed.error).toContain("发布闸门");
    expect(canPublish(failed)).toBe(false);
    expect(publishRun(failed, artifactFor(failed.plan, failed.participants, failed.id, "owner"))).toBe(failed);
  });

  it("keeps the state machine free of scenario-specific branches", () => {
    const source = readFileSync(fileURLToPath(new URL("./run.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/scenario\.id|peft|lora|vertical-modeling/i);
  });
});
