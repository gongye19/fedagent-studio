import { describe, expect, it } from "vitest";
import { checkUpload, dataContract } from "../domain/inputs";
import { buildRunPlan } from "../domain/plan";
import { initialState, inputStatus, reducer, runParticipants, type Action, type State } from "./store";

const apply = (state: State, actions: Action[]) => actions.reduce(reducer, state);

const peftReady: Action[] = [
  { type: "applyTemplate", scenario: "peft-finetune" },
  { type: "toggle", layer: "strategy", value: "peft-fedavg" },
  { type: "toggle", layer: "protection", value: "standard" },
];

const goodJsonl = Array.from({ length: 60 }, (_, index) => JSON.stringify({ instruction: `问题 ${index}`, output: "回答" })).join("\n");

describe("page state", () => {
  it("starts empty and pre-selects matched federated data once a scenario is chosen", () => {
    expect(initialState.datasetIds).toEqual([]);
    const state = apply(initialState, [{ type: "applyTemplate", scenario: "vertical-modeling" }]);
    expect(runParticipants(state).map((participant) => participant.role)).toEqual(["Guest · 持有标签", "Host"]);
  });

  it("re-matches data when a sub-item changes the catalog and keeps the user's picks otherwise", () => {
    const peft = apply(initialState, [...peftReady, { type: "toggleDataset", id: "peft-silo-3" }]);
    expect(runParticipants(peft)).toHaveLength(2);

    const sameCatalog = reducer(peft, { type: "toggle", layer: "protection", value: "tee" });
    expect(runParticipants(sameCatalog)).toHaveLength(2);

    const device = reducer(peft, { type: "toggle", layer: "topology", value: "cross-device" });
    expect(runParticipants(device).every((participant) => participant.role === "端侧设备")).toBe(true);
  });

  it("ignores datasets that do not match the current selection", () => {
    const peft = apply(initialState, peftReady);
    expect(reducer(peft, { type: "toggleDataset", id: "vfl-1" })).toBe(peft);
  });

  it("only counts an upload after the agent check passes", () => {
    const contract = dataContract("peft-finetune", "local-data");
    const peft = apply(initialState, [...peftReady, { type: "addUploads", files: [{ id: "u1", name: "mine.jsonl", size: goodJsonl.length }] }]);
    const plan = buildRunPlan(peft.selection);
    expect(inputStatus(peft, plan).checking).toBe(1);
    expect(inputStatus(peft, plan).ready).toBe(false);

    const passed = reducer(peft, { type: "uploadChecked", id: "u1", check: checkUpload(contract, { name: "mine.jsonl", size: goodJsonl.length, sample: goodJsonl }) });
    expect(inputStatus(passed, plan).ready).toBe(true);
    expect(runParticipants(passed).find((participant) => participant.source === "upload")?.detail).toContain("60 条");
  });

  it("blocks the run while an upload has failed the check", () => {
    const contract = dataContract("peft-finetune", "local-data");
    const failed = apply(initialState, [
      ...peftReady,
      { type: "addUploads", files: [{ id: "u2", name: "wrong.csv", size: 10 }] },
      { type: "uploadChecked", id: "u2", check: checkUpload(contract, { name: "wrong.csv", size: 10, sample: "a,b\n1,2" }) },
    ]);
    const plan = buildRunPlan(failed.selection);
    expect(inputStatus(failed, plan)).toMatchObject({ failed: 1, ready: false });
    expect(reducer(failed, { type: "startRun", id: "run-1", createdAt: "now" }).run).toBeNull();
    expect(inputStatus(reducer(failed, { type: "removeUpload", id: "u2" }), plan).ready).toBe(true);
  });

  it("clears uploads when the scenario changes because the data contract changes", () => {
    const peft = apply(initialState, [...peftReady, { type: "addUploads", files: [{ id: "u3", name: "mine.jsonl", size: 5 }] }]);
    expect(reducer(peft, { type: "applyTemplate", scenario: "fedrag" }).uploads).toEqual([]);
  });

  it("starts a run only with a complete plan and enough data", () => {
    const incomplete = apply(initialState, [{ type: "applyTemplate", scenario: "peft-finetune" }]);
    expect(reducer(incomplete, { type: "startRun", id: "run-1", createdAt: "now" }).run).toBeNull();

    const tooFew = apply(initialState, [
      ...peftReady,
      { type: "toggleDataset", id: "peft-silo-1" },
      { type: "toggleDataset", id: "peft-silo-2" },
    ]);
    expect(reducer(tooFew, { type: "startRun", id: "run-1", createdAt: "now" }).run).toBeNull();

    const ready = apply(initialState, [...peftReady, { type: "startRun", id: "run-1", createdAt: "now" }]);
    expect(ready.run?.plan.scenario.id).toBe("peft-finetune");
    expect(ready.run?.participants).toHaveLength(3);
  });

  it("locks configuration and data while a run exists", () => {
    const running = apply(initialState, [...peftReady, { type: "startRun", id: "run-1", createdAt: "now" }]);
    expect(reducer(running, { type: "toggle", layer: "goal", value: "analytics" })).toBe(running);
    expect(reducer(running, { type: "toggleDataset", id: "peft-silo-1" })).toBe(running);
    expect(reducer(running, { type: "setPreset", preset: "standard" })).toBe(running);
  });

  it("clears the scenario and its sub-items when the active scenario is clicked again", () => {
    const peft = apply(initialState, [{ type: "applyTemplate", scenario: "peft-finetune" }]);
    const cleared = reducer(peft, { type: "clearScenario" });
    expect(cleared.selection.scenario).toBeNull();
    expect(cleared.selection.goal).toBeNull();
    expect(cleared.datasetIds).toEqual([]);
  });

  it("resets to an empty draft", () => {
    const running = apply(initialState, [...peftReady, { type: "startRun", id: "run-1", createdAt: "now" }]);
    expect(reducer(running, { type: "reset" })).toEqual(initialState);
  });
});
