import { expect, it } from "vitest";
import { completedTask } from "../test/fixtures";
import { stepState, stagesOf } from "../domain/task";
import { versionLabel } from "./labels";

it("marks the last generated artifact final when the final round only evaluates", () => {
  const original = completedTask();
  const task = { ...original, rounds: original.rounds.map((r) => ({ ...r, output: r.round === 1 ? r.output : null })) };
  expect(versionLabel(task, task.rounds[0].output!)).toBe("第 1 轮后（最终）");
});

it("uses frozen per-round plans for the vertical stage history", () => {
  const task = completedTask({ status: "running", cursor: { round: 2, stage: "load", done: { "p-a": 1 }, ticks: 0 } });
  task.config = { ...task.config, rounds: 2 };
  task.stages = ["learn", "aggregate", "load", "diagnose"].map((id) => ({ id, label: id, role: "participant",
    per: "site", side: "participant", result: null, seconds: 0, tokens: null, model: false }));
  task.plan = { "1": ["learn", "aggregate"], "2": ["load", "diagnose"] };
  expect(stagesOf(task, 2).map((s) => s.id)).toEqual(["load", "diagnose"]);
  expect(stepState(task, 1, "aggregate")).toBe("done");
  expect(stepState(task, 2, "load")).toBe("current");
  expect(stepState(task, 2, "diagnose")).toBe("pending");
});
