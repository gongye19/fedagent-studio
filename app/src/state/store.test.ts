import { describe, expect, it } from "vitest";
import { initialState, reducer, type Action, type State } from "./store";

const apply = (state: State, actions: Action[]) => actions.reduce(reducer, state);

const peftReady: Action[] = [
  { type: "applyTemplate", scenario: "peft-finetune" },
  { type: "toggle", layer: "strategy", value: "peft-fedavg" },
  { type: "toggle", layer: "protection", value: "standard" },
];

describe("page state", () => {
  it("starts empty and loads demo participants once a scenario is matched", () => {
    expect(initialState.selection.goal).toBeNull();
    expect(initialState.participants).toEqual([]);

    const state = apply(initialState, [{ type: "applyTemplate", scenario: "vertical-modeling" }]);
    expect(state.participants.map((participant) => participant.role)).toEqual(["Guest · 持有标签", "Host"]);
  });

  it("swaps participants when the scenario changes and keeps them otherwise", () => {
    const peft = apply(initialState, [...peftReady, { type: "removeParticipant", id: "peft-finetune-p3" }]);
    expect(peft.participants).toHaveLength(2);

    const sameScenario = reducer(peft, { type: "setParam", id: "rank", value: "32" });
    expect(sameScenario.participants).toHaveLength(2);

    const merge = reducer(peft, { type: "applyTemplate", scenario: "model-merge" });
    expect(merge.participants[0].provides).toBe("LoRA Adapter");
  });

  it("adds demo participants until the pool is exhausted", () => {
    const one = apply(initialState, [...peftReady, { type: "addParticipant" }]);
    expect(one.participants).toHaveLength(4);
    expect(reducer(one, { type: "addParticipant" })).toBe(one);
  });

  it("records uploaded files without their content", () => {
    const state = apply(initialState, [
      { type: "applyTemplate", scenario: "model-merge" },
      { type: "uploadFiles", files: [{ name: "clinic-lora.safetensors", size: 3_400_000, lastModified: 1 }] },
    ]);
    const uploaded = state.participants.find((participant) => participant.source === "upload");
    expect(uploaded?.name).toBe("clinic-lora.safetensors");
    expect(uploaded?.detail).toContain("3.2 MB");
  });

  it("starts a run only with a complete plan and enough participants", () => {
    const incomplete = apply(initialState, [{ type: "applyTemplate", scenario: "peft-finetune" }]);
    expect(reducer(incomplete, { type: "startRun", id: "run-1", createdAt: "now" }).run).toBeNull();

    const tooFew = apply(initialState, [
      ...peftReady,
      { type: "removeParticipant", id: "peft-finetune-p1" },
      { type: "removeParticipant", id: "peft-finetune-p2" },
    ]);
    expect(reducer(tooFew, { type: "startRun", id: "run-1", createdAt: "now" }).run).toBeNull();

    const ready = apply(initialState, [...peftReady, { type: "startRun", id: "run-1", createdAt: "now" }]);
    expect(ready.run?.plan.scenario.id).toBe("peft-finetune");
  });

  it("locks configuration and participants while a run exists", () => {
    const running = apply(initialState, [...peftReady, { type: "startRun", id: "run-1", createdAt: "now" }]);
    expect(reducer(running, { type: "toggle", layer: "goal", value: "analytics" })).toBe(running);
    expect(reducer(running, { type: "removeParticipant", id: "peft-finetune-p1" })).toBe(running);
    expect(reducer(running, { type: "setPreset", preset: "standard" })).toBe(running);
  });

  it("clears the scenario and its sub-items when the active scenario is clicked again", () => {
    const peft = apply(initialState, [{ type: "applyTemplate", scenario: "peft-finetune" }]);
    const cleared = reducer(peft, { type: "clearScenario" });
    expect(cleared.selection.scenario).toBeNull();
    expect(cleared.selection.goal).toBeNull();
    expect(cleared.participants).toEqual([]);
  });

  it("resets to an empty draft", () => {
    const running = apply(initialState, [...peftReady, { type: "startRun", id: "run-1", createdAt: "now" }]);
    expect(reducer(running, { type: "reset" })).toEqual(initialState);
  });
});
