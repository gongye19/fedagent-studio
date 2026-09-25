import { describe, expect, it } from "vitest";
import { checkUpload, dataContract } from "../domain/inputs";
import { buildRunPlan } from "../domain/plan";
import { initialState, inputStatus, reducer, runParticipants, type Action, type State } from "./store";

const apply = (state: State, actions: Action[]) => actions.reduce(reducer, state);

const memoryReady: Action[] = [
  { type: "applyTemplate", scenario: "agent-memory" },
  { type: "toggle", layer: "strategy", value: "mem-dedup" },
];
const trainingReady: Action[] = [
  { type: "applyTemplate", scenario: "horizontal-training" },
  { type: "toggle", layer: "strategy", value: "hfl-fedavg" },
];

const memoryContract = dataContract({ scenario: "agent-memory" });
const goodMemory = Array.from({ length: 6 }, (_, index) => JSON.stringify({ type: "experience", content: `经验 ${index}` })).join("\n");

describe("page state", () => {
  it("starts empty and pre-selects existing participants once a scenario is chosen", () => {
    expect(initialState.datasetIds).toEqual([]);
    const state = apply(initialState, [{ type: "applyTemplate", scenario: "vertical-training" }]);
    expect(runParticipants(state).map((participant) => participant.role)).toEqual(["标签方", "特征方"]);
  });

  it("re-matches nodes when a sub-item changes and keeps the user's picks otherwise", () => {
    const training = apply(initialState, [...trainingReady, { type: "toggleDataset", id: "hfl-image-3" }]);
    expect(runParticipants(training)).toHaveLength(2);

    const sameCatalog = reducer(training, { type: "toggleEnhancement", id: "secagg" });
    expect(runParticipants(sameCatalog)).toHaveLength(2);
    expect(sameCatalog.selection.enhancements).toEqual(["secagg"]);

    const tree = reducer(training, { type: "toggle", layer: "modelClass", value: "tree" });
    expect(runParticipants(tree).every((participant) => participant.provides === "理赔表")).toBe(true);
  });

  it("ignores participants that do not match the current selection", () => {
    const memory = apply(initialState, memoryReady);
    expect(reducer(memory, { type: "toggleDataset", id: "vfl-1" })).toBe(memory);
  });

  it("connects our own node only in node scenarios and counts it once online", () => {
    const training = apply(initialState, trainingReady);
    const plan = buildRunPlan(training.selection);
    const connecting = reducer(training, { type: "connectNode" });
    expect(inputStatus(connecting, plan)).toMatchObject({ checking: 1, ready: false });
    const online = reducer(connecting, { type: "nodeOnline" });
    expect(runParticipants(online).find((participant) => participant.source === "node")?.name).toBe("我方节点");
    expect(inputStatus(online, plan).count).toBe(4);
    expect(runParticipants(reducer(online, { type: "disconnectNode" }))).toHaveLength(3);

    const memory = apply(initialState, memoryReady);
    expect(reducer(memory, { type: "connectNode" })).toBe(memory);
    expect(reducer(training, { type: "addUploads", files: [{ id: "u0", name: "x.jsonl", size: 1 }] })).toBe(training);
  });

  it("only counts an upload after the agent check passes", () => {
    const memory = apply(initialState, [...memoryReady, { type: "addUploads", files: [{ id: "u1", name: "mine.jsonl", size: goodMemory.length }] }]);
    const plan = buildRunPlan(memory.selection);
    expect(inputStatus(memory, plan)).toMatchObject({ checking: 1, ready: false });

    const passed = reducer(memory, { type: "uploadChecked", id: "u1", check: checkUpload(memoryContract, { name: "mine.jsonl", size: goodMemory.length, sample: goodMemory }) });
    expect(inputStatus(passed, plan).ready).toBe(true);
    expect(runParticipants(passed).find((participant) => participant.source === "upload")?.detail).toContain("6 条");
  });

  it("blocks the run while an upload has failed the check", () => {
    const failed = apply(initialState, [
      ...memoryReady,
      { type: "addUploads", files: [{ id: "u2", name: "wrong.csv", size: 10 }] },
      { type: "uploadChecked", id: "u2", check: checkUpload(memoryContract, { name: "wrong.csv", size: 10, sample: "a,b\n1,2" }) },
    ]);
    const plan = buildRunPlan(failed.selection);
    expect(inputStatus(failed, plan)).toMatchObject({ failed: 1, ready: false });
    expect(reducer(failed, { type: "startRun", id: "run-1", createdAt: "now" }).run).toBeNull();
    expect(inputStatus(reducer(failed, { type: "removeUpload", id: "u2" }), plan).ready).toBe(true);
  });

  it("clears uploads and our node when the data requirements change", () => {
    const memory = apply(initialState, [...memoryReady, { type: "addUploads", files: [{ id: "u3", name: "mine.jsonl", size: 5 }] }]);
    expect(reducer(memory, { type: "applyTemplate", scenario: "federated-analytics" }).uploads).toEqual([]);

    const online = apply(initialState, [...trainingReady, { type: "connectNode" }, { type: "nodeOnline" }]);
    expect(reducer(online, { type: "toggle", layer: "sharing", value: "peft" }).ownNode).toBe("none");
  });

  it("starts a run only with a complete plan and enough participants", () => {
    const incomplete = apply(initialState, [{ type: "applyTemplate", scenario: "horizontal-training" }]);
    expect(reducer(incomplete, { type: "startRun", id: "run-1", createdAt: "now" }).run).toBeNull();

    const tooFew = apply(initialState, [
      ...memoryReady,
      { type: "toggleDataset", id: "mem-1" },
      { type: "toggleDataset", id: "mem-2" },
    ]);
    expect(reducer(tooFew, { type: "startRun", id: "run-1", createdAt: "now" }).run).toBeNull();

    const ready = apply(initialState, [...trainingReady, { type: "startRun", id: "run-1", createdAt: "now" }]);
    expect(ready.run?.plan.scenario.id).toBe("horizontal-training");
    expect(ready.run?.participants).toHaveLength(3);
  });

  it("locks configuration and data while a run exists", () => {
    const running = apply(initialState, [...trainingReady, { type: "startRun", id: "run-1", createdAt: "now" }]);
    expect(reducer(running, { type: "toggle", layer: "modelClass", value: "tree" })).toBe(running);
    expect(reducer(running, { type: "toggleDataset", id: "hfl-image-1" })).toBe(running);
    expect(reducer(running, { type: "connectNode" })).toBe(running);
    expect(reducer(running, { type: "setPreset", preset: "standard" })).toBe(running);
  });

  it("clears the scenario and its sub-items when the active scenario is clicked again", () => {
    const training = apply(initialState, trainingReady);
    const cleared = reducer(training, { type: "clearScenario" });
    expect(cleared.selection.scenario).toBeNull();
    expect(cleared.selection.modelClass).toBeNull();
    expect(cleared.datasetIds).toEqual([]);
  });

  it("resets to an empty draft", () => {
    const running = apply(initialState, [...trainingReady, { type: "startRun", id: "run-1", createdAt: "now" }]);
    expect(reducer(running, { type: "reset" })).toEqual(initialState);
  });
});
