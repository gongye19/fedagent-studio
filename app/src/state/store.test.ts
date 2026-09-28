import { describe, expect, it } from "vitest";
import { hrefOf, parseHash, type Route } from "./route";
import { seedState } from "./seed";
import { reducer, type State } from "./store";

const NOW = "2026-09-28T16:00:00+08:00";

function ready(state: State): State {
  return reducer(state, { type: "chooseScenario", scenario: "horizontal" });
}

describe("store", () => {
  it("creates a task from a complete draft and resets the draft", () => {
    const state = ready(seedState());
    const next = reducer(state, { type: "createTask", id: "task-new", createdAt: NOW });
    expect(next.tasks[0]).toMatchObject({ id: "task-new", status: "running" });
    expect(next.tasks[0].name).toMatch(/^FoT 任务 \d{2}-\d{2} \d{2}:\d{2}$/);
    expect(next.tasks[0].members).toHaveLength(8);
    expect(next.draft.scenario).toBeNull();
  });

  it("ignores create when the draft is incomplete", () => {
    const state = seedState();
    expect(reducer(state, { type: "createTask", id: "x", createdAt: NOW })).toBe(state);
    const vertical = reducer(state, { type: "chooseScenario", scenario: "vertical" });
    expect(reducer(vertical, { type: "createTask", id: "x", createdAt: NOW })).toBe(vertical);
  });

  it("ticks only running tasks", () => {
    const state = seedState();
    const next = reducer(state, { type: "tick", now: NOW });
    const completed = state.tasks.find((task) => task.status === "completed")!;
    expect(next.tasks.find((task) => task.id === completed.id)).toBe(completed);
    expect(next.tasks.find((task) => task.id === "task-trial-4")).not.toBe(state.tasks.find((task) => task.id === "task-trial-4"));
  });

  it("publishes a library version once", () => {
    const state = seedState();
    const action = { type: "publish", id: "lib-r2", taskId: "task-paper-math8", builtAfterRound: 2, name: "第 3 轮版本", publishedAt: NOW } as const;
    const once = reducer(state, action);
    expect(once.published).toHaveLength(2);
    expect(reducer(once, { ...action, id: "lib-r2-again" })).toBe(once);
    expect(reducer(state, { ...action, builtAfterRound: 9 })).toBe(state);
  });

  it("removes custom participants with their data, never built-in ones", () => {
    let state = seedState();
    state = reducer(state, {
      type: "addParticipant",
      participant: { id: "p-new", name: "新参与方", org: "", intro: "", hosting: "platform", status: "online" },
      dataset: { id: "ds-new", name: "新题库", participantId: "p-new", description: "", taskType: "math-reasoning", count: 3, answered: 3, source: "upload" },
    });
    state = ready(state);
    expect(state.draft.datasetIds).toContain("ds-new");
    const removed = reducer(state, { type: "removeParticipant", id: "p-new" });
    expect(removed.datasets.some((dataset) => dataset.id === "ds-new")).toBe(false);
    expect(removed.draft.datasetIds).not.toContain("ds-new");
    expect(reducer(removed, { type: "removeParticipant", id: "p-amc" })).toBe(removed);
  });
});

describe("route", () => {
  it("round-trips every page", () => {
    const routes: Route[] = [
      { page: "tasks" },
      { page: "newTask" },
      { page: "newTask", scenario: "horizontal" },
      { page: "task", id: "task-1" },
      { page: "task", id: "task-1", tab: "library" },
      { page: "libraries" },
      { page: "library", id: "lib-1", tab: "try" },
      { page: "participants" },
      { page: "participants", id: "p-amc" },
      { page: "models" },
    ];
    for (const route of routes) expect(parseHash(hrefOf(route))).toEqual(route);
  });

  it("falls back for unknown pages and tabs", () => {
    expect(parseHash("#/nowhere")).toEqual({ page: "tasks" });
    expect(parseHash("#/tasks")).toEqual({ page: "tasks" });
    expect(parseHash("#/tasks/t1/uploads")).toEqual({ page: "task", id: "t1", tab: undefined });
    expect(parseHash("#/tasks/t1/unknown")).toEqual({ page: "task", id: "t1", tab: undefined });
  });
});
