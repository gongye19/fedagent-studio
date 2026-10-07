import { describe, expect, it } from "vitest";
import { completedTask } from "../test/fixtures";
import { accuracy, averageAccuracy, changeOf, latestScoredRound, negativeTransfer, outputs, progressOf, stepState, totalTokens } from "./task";

describe("task metrics", () => {
  it("reports round 1 as the local baseline and the last scored round as federated", () => {
    const task = completedTask();
    const [a, b] = task.members;
    expect(accuracy(task, a, 1)).toBe(0.3);
    expect(averageAccuracy(task, 1)).toBe(0.4);
    expect(latestScoredRound(task)).toBe(3);
    expect(changeOf(task, a)).toBeCloseTo(0.3);
    expect(changeOf(task, b)).toBeCloseTo(-0.1);
  });

  it("flags negative transfer against each participant's own round 1", () => {
    expect(negativeTransfer(completedTask())).toEqual({ count: 1, total: 2 });
    expect(negativeTransfer(completedTask({ rounds: completedTask().rounds.slice(0, 1) }))).toBeNull();
  });

  it("lists output versions in round order and sums tokens", () => {
    const task = completedTask();
    expect(outputs(task).map((version) => version.builtAfterRound)).toEqual([1, 2, 3]);
    expect(totalTokens(task)).toBe(2700);
  });

  it("derives progress and step states from the backend cursor", () => {
    const done = completedTask();
    expect(progressOf(done)).toBe(1);
    const running = completedTask({ status: "running", rounds: [], cursor: { round: 2, stage: "extract", done: { "p-a": 5, "p-b": 5 }, ticks: 0 } });
    expect(stepState(running, 1, "library")).toBe("done");
    expect(stepState(running, 2, "reflect")).toBe("done");
    expect(stepState(running, 2, "extract")).toBe("current");
    expect(stepState(running, 2, "collect")).toBe("pending");
    expect(stepState(running, 3, "solve")).toBe("pending");
    // 第 2 轮第 3 步做了一半：(6 + 2 + 0.5) / 18
    expect(progressOf(running)).toBeCloseTo(8.5 / 18);
    const queued = completedTask({ status: "queued", rounds: [], cursor: { round: 1, stage: "solve", done: {}, ticks: 0 } });
    expect(progressOf(queued)).toBe(0);
  });

  it("does not invent progress while a server step is executing or paused", () => {
    const cursor = { round: 2, stage: "collect" as const, done: {}, ticks: 0 };
    const running = completedTask({ status: "running", cursor });
    expect(progressOf(running)).toBeCloseTo(9 / 18);
    expect(progressOf({ ...running, status: "paused" })).toBe(progressOf(running));
  });
});
