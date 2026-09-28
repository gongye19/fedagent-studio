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

/** 另外登记的接口，用来测试"给某个参与方单独指定模型"。 */
const LAB: Endpoint = { id: "lab", name: "实验室接口", baseUrl: "http://10.0.0.1/v1", models: ["m1"], concurrency: 4, price: null };

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
    const withLab = toConfig(draft({ clientOverrides: { "ds-amc": "lab:m1" } }))!;
    expect(estimate(withLab, BUILTIN_DATASETS, [...priced, LAB]).cost).toBeNull();
    expect(estimate(config, BUILTIN_DATASETS, DEFAULT_ENDPOINTS).cost).toBeNull();
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
    // 默认走预留的 LLM 接口，接口还没配置也能创建任务。
    expect(draft().clientModel).toBe("default");
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
    const withOverride = draft({ clientOverrides: { "ds-amc": "lab:m1" } });
    const deselected = toggleDataset(withOverride, "ds-amc");
    expect(activeOverrides(deselected)).toEqual({});
    expect(toConfig(deselected)?.clientOverrides).toEqual({});
  });

  it("names tasks by algorithm and time, without repeating the summary", () => {
    const at = new Date(2026, 8, 28, 16, 36);
    expect(defaultTaskName(draft({ mode: "trial" }), at)).toBe("FoT 任务 · 09-28 16:36");
    expect(defaultTaskName(withDefaults({}), at)).toBe("联邦任务 · 09-28 16:36");
  });
});
