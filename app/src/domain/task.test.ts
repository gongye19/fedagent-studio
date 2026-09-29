import { describe, expect, it } from "vitest";
import { FOT_STAGES } from "./catalog";
import { toConfig, withDefaults, type Draft, type TaskParticipant } from "./config";
import { BUILTIN_DATASETS, BUILTIN_PARTICIPANTS } from "./resources";
import {
  averageAccuracy,
  cancel,
  changeOf,
  createTask,
  negativeTransfer,
  outputs,
  pause,
  progressOf,
  resume,
  stepState,
  tick,
  totalTokens,
  type Task,
} from "./task";
import { seedState } from "../state/seed";

const NOW = "2026-09-28T10:00:00+08:00";

/** 参与方 A、C、D 各出自己的数据集（AIME24、AMC、CCEE）。 */
const PICKS: TaskParticipant[] = ["ds-aime24", "ds-amc", "ds-ccee"].map((id) => {
  const dataset = BUILTIN_DATASETS.find((item) => item.id === id)!;
  return { participantId: dataset.participantId, datasetId: dataset.id };
});

function newTask(patch: Partial<Draft> = {}): Task {
  const config = toConfig(withDefaults({
    scenario: "horizontal",
    taskType: "math-reasoning",
    algorithm: "fot",
    participants: PICKS,
    ...patch,
  }))!;
  return createTask({ id: "t1", name: "测试", createdAt: NOW, config, datasets: BUILTIN_DATASETS, participants: BUILTIN_PARTICIPANTS });
}

function runToEnd(task: Task): Task {
  let current = task;
  for (let guard = 0; guard < 1000 && current.status === "running"; guard += 1) current = tick(current, NOW);
  return current;
}

describe("task", () => {
  it("freezes each participant with its dataset, trial cap and model", () => {
    const task = newTask({ mode: "trial", trialCap: 5, clientOverrides: { "p-c": "lab:m1" } });
    expect(task.members.map((member) => [member.participant, member.dataset, member.problems, member.model])).toEqual([
      ["参与方 A", "AIME24", 5, "default"],
      ["参与方 C", "AMC", 5, "lab:m1"],
      ["参与方 D", "CCEE", 5, "default"],
    ]);
    expect(task.cursor).toEqual({ round: 1, stage: "solve", done: {}, ticks: 0 });
  });

  it("skips picks whose dataset does not belong to the participant", () => {
    const task = newTask({ participants: [...PICKS, { participantId: "p-b", datasetId: "ds-amc" }] });
    expect(task.members.map((member) => member.participantId)).toEqual(["p-a", "p-c", "p-d"]);
  });

  it("runs every stage of every round and records results", () => {
    const done = runToEnd(newTask({ mode: "trial", rounds: 3 }));
    expect(done.status).toBe("completed");
    expect(done.cursor).toBeNull();
    expect(done.rounds.map((record) => record.round)).toEqual([1, 2, 3]);
    for (const record of done.rounds) {
      expect(Object.keys(record.correct ?? {})).toEqual(["p-a", "p-c", "p-d"]);
      expect(Object.keys(record.uploads ?? {})).toHaveLength(3);
      expect(record.groups?.length).toBeGreaterThan(0);
      expect(record.output?.items.length).toBeGreaterThan(0);
      expect(record.tokens).toBeGreaterThan(0);
    }
    expect(progressOf(done)).toBe(1);
    expect(totalTokens(done)).toBeGreaterThan(0);
  });

  it("keeps each output version inside the next one", () => {
    const done = runToEnd(newTask({ mode: "full", rounds: 3 }));
    const versions = outputs(done).map((output) => output.items.map((item) => item.key));
    expect(versions).toHaveLength(3);
    versions.slice(1).forEach((keys, index) => {
      expect(keys.length).toBeGreaterThanOrEqual(versions[index].length);
      expect(keys.slice(0, versions[index].length)).toEqual(versions[index]);
    });
  });

  it("only moves while running", () => {
    const started = tick(newTask(), NOW);
    const paused = pause(started);
    expect(tick(paused, NOW)).toBe(paused);
    const resumed = resume(paused);
    expect(tick(resumed, NOW)).not.toBe(resumed);
    const canceled = cancel(resumed, NOW);
    expect(canceled.status).toBe("canceled");
    expect(canceled.cursor).toEqual(resumed.cursor);
    expect(tick(canceled, NOW)).toBe(canceled);
  });

  it("advances progress monotonically and marks the current step", () => {
    let task = newTask({ mode: "trial", rounds: 2 });
    let last = progressOf(task);
    for (let index = 0; index < 20; index += 1) {
      task = tick(task, NOW);
      const now = progressOf(task);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    const cursor = task.cursor!;
    expect(stepState(task, cursor.round, cursor.stage)).toBe("current");
    expect(stepState(task, cursor.round + 1, "solve")).toBe("pending");
    expect(FOT_STAGES.filter((stage) => stepState(task, 1, stage.id) === "done").length).toBeGreaterThan(0);
  });
});

describe("metrics on the seeded paper task", () => {
  const task = seedState().tasks.find((item) => item.id === "task-paper-math8")!;

  it("reports round 1 as the local baseline and round 3 with the shared output", () => {
    expect(averageAccuracy(task, 1)).toBeCloseTo(0.4069, 3);
    expect(averageAccuracy(task, 3)).toBeCloseTo(0.4648, 3);
  });

  it("flags negative transfer against each participant's own round 1", () => {
    const wlpmc = task.members.find((member) => member.datasetId === "ds-wlpmc")!;
    expect(changeOf(task, wlpmc)).toBeCloseTo(-1 / 11);
    expect(negativeTransfer(task)).toEqual({ count: 1, total: 8 });
  });
});

describe("sample groups", () => {
  it("assigns every upload to exactly one group", () => {
    const task = runToEnd(newTask({ mode: "full", rounds: 2 }));
    for (const record of task.rounds) {
      const groups = record.groups!;
      for (const member of task.members) {
        const assigned = groups.reduce((sum, group) => sum + (group.uploads[member.participantId] ?? 0), 0);
        expect(assigned).toBe(record.uploads![member.participantId]);
      }
      const total = groups.reduce((sum, group) => sum + Object.values(group.uploads).reduce((a, b) => a + b, 0), 0);
      expect(total).toBe(record.output!.uploadCount);
    }
  });
});
