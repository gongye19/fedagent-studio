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

  it("counts only the user's own changes as touching the draft", () => {
    const auto = reducer(seedState(), { type: "chooseScenario", scenario: "horizontal", auto: true });
    expect(auto.draft.algorithm).toBe("fot");
    expect(auto.draft.touched).toBe(false);
    const edited = reducer(auto, { type: "updateDraft", patch: { rounds: 4 } });
    expect(edited.draft.touched).toBe(true);
    expect(reducer(auto, { type: "toggleDataset", datasetId: "ds-amc" }).draft.touched).toBe(true);
  });

  it("names the task with the name shown on the page when the user left it unchanged", () => {
    const state = ready(seedState());
    const named = reducer(state, { type: "createTask", id: "task-a", createdAt: NOW, name: "FoT 任务 09-28 15:59" });
    expect(named.tasks[0].name).toBe("FoT 任务 09-28 15:59");
    const typed = reducer(reducer(state, { type: "updateDraft", patch: { name: "我的任务" } }), { type: "createTask", id: "task-b", createdAt: NOW, name: "ignored" });
    expect(typed.tasks[0].name).toBe("我的任务");
  });

  it("renames and unpublishes apps", () => {
    const state = seedState();
    const renamed = reducer(state, { type: "renamePublished", id: "lib-paper-math8", name: "  新名字 " });
    expect(renamed.published[0].name).toBe("新名字");
    expect(reducer(state, { type: "renamePublished", id: "lib-paper-math8", name: "  " })).toBe(state);
    expect(reducer(state, { type: "unpublish", id: "lib-paper-math8" }).published).toHaveLength(0);
  });

  it("removes added endpoints but keeps the reserved default one", () => {
    const withLab = reducer(seedState(), { type: "addEndpoint", endpoint: { id: "lab", name: "实验室", baseUrl: "http://x/v1", models: ["m1"], concurrency: 4, price: null } });
    expect(reducer(withLab, { type: "removeEndpoint", id: "lab" }).endpoints.map((item) => item.id)).toEqual(["default"]);
    expect(reducer(withLab, { type: "removeEndpoint", id: "default" })).toBe(withLab);
  });

  it("removes custom participants with their data, never built-in ones", () => {
    let state = seedState();
    state = reducer(state, {
      type: "addParticipant",
      participant: { id: "p-new", name: "新参与方", org: "", intro: "", hosting: "platform", status: "online" },
      dataset: { id: "ds-new", name: "新题库", participantId: "p-new", description: "", taskType: "math-reasoning", count: 3, answered: 3, source: "upload" },
    });
    expect(state.participants[0].id).toBe("p-new");
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
      { page: "home" },
      { page: "tasks" },
      { page: "newTask" },
      { page: "newTask", scenario: "horizontal" },
      { page: "task", id: "task-1" },
      { page: "task", id: "task-1", tab: "output" },
      { page: "apps" },
      { page: "app", id: "lib-1", tab: "try" },
      { page: "participants" },
      { page: "participants", id: "p-amc" },
      { page: "newParticipant" },
      { page: "newParticipant", from: "newTask" },
      { page: "algorithms" },
      { page: "algorithms", id: "fot" },
      { page: "models" },
      { page: "newEndpoint" },
      { page: "editEndpoint", id: "default", from: "newTask" },
    ];
    for (const route of routes) expect(parseHash(hrefOf(route))).toEqual(route);
  });

  it("falls back for unknown pages and tabs", () => {
    expect(parseHash("#/nowhere")).toEqual({ page: "home" });
    expect(parseHash("#/tasks")).toEqual({ page: "tasks" });
    expect(parseHash("#/libraries/lib-1")).toEqual({ page: "app", id: "lib-1", tab: undefined });
    expect(parseHash("#/tasks/t1/uploads")).toEqual({ page: "task", id: "t1", tab: undefined });
    expect(parseHash("#/tasks/t1/unknown")).toEqual({ page: "task", id: "t1", tab: undefined });
  });
});
