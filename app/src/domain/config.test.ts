import { describe, expect, it } from "vitest";
import {
  activeOverrides,
  chooseScenario,
  DEFAULT_DRAFT,
  defaultTaskName,
  draftIssues,
  estimate,
  toConfig,
  toggleDataset,
  withDefaults,
  type Draft,
} from "./config";
import { BUILTIN_DATASETS, BUILTIN_PARTICIPANTS, DEFAULT_ENDPOINTS, type Endpoint } from "./resources";

const ALL = BUILTIN_DATASETS.map((dataset) => dataset.id);

function draft(patch: Partial<Draft> = {}): Draft {
  return withDefaults({ scenario: "horizontal", algorithm: "fot", datasetIds: ALL, ...patch });
}

describe("estimate", () => {
  it("counts paper-scale calls exactly: 300 problems × 3 steps × 3 rounds", () => {
    const config = toConfig(draft({ mode: "full", rounds: 3 }))!;
    const result = estimate(config, BUILTIN_DATASETS, DEFAULT_ENDPOINTS);
    expect(result.problems).toBe(300);
    expect(result.participantCalls).toBe(2700);
    expect(result.serverCalls).toBe(6);
    expect(result.cost).toBeNull();
  });

  it("caps each dataset in a trial run", () => {
    const config = toConfig(draft({ mode: "trial", trialCap: 5, rounds: 2 }))!;
    const result = estimate(config, BUILTIN_DATASETS, DEFAULT_ENDPOINTS);
    expect(result.problems).toBe(40);
    expect(result.participantCalls).toBe(240);
  });

  it("prices only when every endpoint in use has a price", () => {
    const priced: Endpoint[] = DEFAULT_ENDPOINTS.map((endpoint) => ({ ...endpoint, price: 2 }));
    const config = toConfig(draft({ mode: "full" }))!;
    const result = estimate(config, BUILTIN_DATASETS, priced);
    expect(result.cost).toBeCloseTo(((result.participantTokens + result.serverTokens) * 2) / 1_000_000);
    const partly = priced.map((endpoint) => (endpoint.id === "glm" ? { ...endpoint, price: null } : endpoint));
    const withGlm = toConfig(draft({ clientOverrides: { "ds-amc": "glm:glm-5.1" } }))!;
    expect(estimate(withGlm, BUILTIN_DATASETS, partly).cost).toBeNull();
  });
});

describe("draft", () => {
  it("lists what is missing in page order", () => {
    const empty = withDefaults({});
    expect(draftIssues(empty, BUILTIN_DATASETS, BUILTIN_PARTICIPANTS, DEFAULT_ENDPOINTS).map((issue) => issue.field)).toEqual(["scenario"]);
    const planned = withDefaults({ scenario: "vertical" });
    expect(draftIssues(planned, BUILTIN_DATASETS, BUILTIN_PARTICIPANTS, DEFAULT_ENDPOINTS)[0].message).toContain("规划中");
    const one = draft({ datasetIds: ["ds-amc"], serverModel: "missing:model" });
    expect(draftIssues(one, BUILTIN_DATASETS, BUILTIN_PARTICIPANTS, DEFAULT_ENDPOINTS).map((issue) => issue.field)).toEqual(["datasets", "models"]);
    expect(draftIssues(draft(), BUILTIN_DATASETS, BUILTIN_PARTICIPANTS, DEFAULT_ENDPOINTS)).toEqual([]);
  });

  it("choosing horizontal selects FoT and every usable dataset; planned scenarios select nothing", () => {
    const horizontal = chooseScenario(DEFAULT_DRAFT, "horizontal", BUILTIN_DATASETS, BUILTIN_PARTICIPANTS);
    expect(horizontal.algorithm).toBe("fot");
    expect(horizontal.datasetIds).toEqual(ALL);
    const vertical = chooseScenario(horizontal, "vertical", BUILTIN_DATASETS, BUILTIN_PARTICIPANTS);
    expect(vertical.algorithm).toBeNull();
    expect(vertical.datasetIds).toEqual([]);
  });

  it("skips datasets whose participant is offline", () => {
    const participants = BUILTIN_PARTICIPANTS.map((participant) => (
      participant.id === "p-amc" ? { ...participant, status: "offline" as const } : participant
    ));
    const chosen = chooseScenario(DEFAULT_DRAFT, "horizontal", BUILTIN_DATASETS, participants);
    expect(chosen.datasetIds).not.toContain("ds-amc");
  });

  it("drops per-participant models of deselected datasets", () => {
    const withOverride = draft({ clientOverrides: { "ds-amc": "glm:glm-5.1" } });
    const deselected = toggleDataset(withOverride, "ds-amc");
    expect(activeOverrides(deselected)).toEqual({});
    expect(toConfig(deselected)?.clientOverrides).toEqual({});
  });

  it("names tasks from the choices", () => {
    expect(defaultTaskName(draft({ mode: "trial" }))).toBe("横向联邦 · FoT · 8 方 · 试跑");
    expect(defaultTaskName(withDefaults({}))).toBe("新任务");
  });
});
