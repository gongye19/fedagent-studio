import { describe, expect, it } from "vitest";
import { DATASETS } from "../test/fixtures";
import { withDefaults } from "../domain/config";
import { hrefOf, parseHash, type Route } from "./route";
import { reducer, withoutMissing } from "./store";
import { decodeDraft } from "./draft";

describe("draft", () => {
  it("migrates old automatic model defaults once and preserves new explicit choices", () => {
    const stored = withDefaults({ name: "未完成任务", scenario: "horizontal", touched: true, clientModel: "default", serverModel: "default" });
    const migrated = decodeDraft(JSON.stringify(stored));
    expect([migrated.name, migrated.scenario, migrated.clientModel, migrated.serverModel]).toEqual(["未完成任务", "horizontal", "", ""]);
    expect(decodeDraft(JSON.stringify({ ...stored, selectionVersion: 2 }))).toEqual(stored);
    expect(decodeDraft(JSON.stringify({ ...migrated, selectionVersion: 2 }))).toEqual(migrated);
  });

  it("counts only the user's own changes as touching the draft", () => {
    const auto = reducer(withDefaults({}), { type: "chooseScenario", scenario: "horizontal", auto: true }, DATASETS);
    expect(auto.scenario).toBe("horizontal");
    expect(auto.algorithm).toBeNull();
    expect(auto.touched).toBe(false);
    expect(reducer(auto, { type: "updateDraft", patch: { rounds: 4 } }, DATASETS).touched).toBe(true);
    expect(reducer(auto, { type: "pickDataset", participantId: "p-a", datasetId: "ds-aime24" }, DATASETS).touched).toBe(true);
    // 只能选这个参与方自己的数据集
    expect(reducer(auto, { type: "pickDataset", participantId: "p-b", datasetId: "ds-aime24" }, DATASETS)).toBe(auto);
  });

  it("forgets datasets that no longer exist, with their per-participant models", () => {
    const draft = withDefaults({
      participants: [{ participantId: "p-a", datasetId: "ds-aime24" }, { participantId: "p-b", datasetId: "ds-gone" }],
      clientOverrides: { "p-b": "ep-1:m1" },
    });
    const cleaned = withoutMissing(draft, DATASETS);
    expect(cleaned.participants).toEqual([{ participantId: "p-a", datasetId: "ds-aime24" }]);
    expect(cleaned.clientOverrides).toEqual({});
    expect(withoutMissing(cleaned, DATASETS)).toBe(cleaned);
  });

  it("resets to the defaults, or to a copied task's config", () => {
    const copied = reducer(withDefaults({}), { type: "resetDraft", draft: { name: "任务（副本）", rounds: 4 } }, DATASETS);
    expect([copied.name, copied.rounds, copied.scenario]).toEqual(["任务（副本）", 4, null]);
  });
});

describe("route", () => {
  it("round-trips every page", () => {
    const routes: Route[] = [
      { page: "home" },
      { page: "tasks" },
      { page: "newTask", scenario: "horizontal" },
      { page: "newTask", scenario: "vertical" },
      { page: "task", id: "task-1" },
      { page: "task", id: "task-1", tab: "output" },
      { page: "results" },
      { page: "apps" },
      { page: "consultation", packageId: "app-1" },
      { page: "application", taskType: "medical-records" },
      { page: "newTask", application: "medical-records" },
      { page: "app", id: "lib-1", tab: "try" },
      { page: "participants" },
      { page: "participants", id: "p-c" },
      { page: "participants", scenario: "horizontal" },
      { page: "participants", scenario: "vertical", id: "p-c" },
      { page: "newParticipant" },
      { page: "newParticipant", from: "newTask" },
      { page: "newDataset" },
      { page: "newDataset", participant: "p-c" },
      { page: "newDataset", participant: "p-c", from: "newTask" },
      { page: "newDataset", from: "newTask" },
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
    expect(parseHash("#/tasks/new")).toEqual({ page: "newTask" });
    expect(parseHash("#/tasks/new/nowhere")).toEqual({ page: "tasks" });
    expect(parseHash("#/libraries/lib-1")).toEqual({ page: "app", id: "lib-1", tab: undefined });
    expect(parseHash("#/consultation?package=app-1")).toEqual({ page: "consultation", packageId: "app-1" });
    expect(parseHash("#/tasks/t1/uploads")).toEqual({ page: "task", id: "t1", tab: undefined });
    expect(parseHash("#/tasks/t1/unknown")).toEqual({ page: "task", id: "t1", tab: undefined });
    // 数据集已并入"参与方与数据"
    expect(parseHash("#/datasets")).toEqual({ page: "participants" });
    expect(parseHash("#/datasets/ds-amc")).toEqual({ page: "participants" });
  });

  it("keeps resource space, kind and selected resource in navigable URLs", () => {
    const routes:Route[] = [{page:"newTask"},{page:"resources",space:"workspace",kind:"data",id:"ds-own"},{page:"resources",space:"public",kind:"models"},{page:"resources",space:"workspace",kind:"agents"}];
    for (const route of routes) expect(parseHash(hrefOf(route))).toEqual({...route,...(route.page==="resources"&&!('id' in route)?{id:undefined}:{})});
  });
});
