import { describe, expect, it } from "vitest";
import { algorithmOf, defaultParams, paramText } from "./catalog";
import {
  activeOverrides,
  chooseAlgorithm,
  chooseScenario,
  chooseTaskType,
  DEFAULT_DRAFT,
  defaultTaskName,
  draftIssues,
  estimate,
  joinable,
  pickDataset,
  setParticipants,
  toConfig,
  withDefaults,
  type Draft,
  type TaskParticipant,
} from "./config";
import { BUILTIN_DATASETS, BUILTIN_PARTICIPANTS, DEFAULT_ENDPOINTS, modelLabel, modelOptions, type Dataset, type Endpoint } from "./resources";

/** 另外登记的接口，用来测试"给某个参与方单独指定模型"。 */
const LAB: Endpoint = { id: "lab", name: "实验室接口", baseUrl: "http://10.0.0.1/v1", models: ["m1"], concurrency: 4, price: null };

/** 内置示例：参与方 A–H 各出自己的那份数据集。 */
const ALL: TaskParticipant[] = BUILTIN_DATASETS.map((dataset) => ({ participantId: dataset.participantId, datasetId: dataset.id }));
const AMC = ALL.find((item) => item.datasetId === "ds-amc")!;

function draft(patch: Partial<Draft> = {}): Draft {
  return withDefaults({ scenario: "horizontal", taskType: "math-reasoning", algorithm: "fot", participants: ALL, params: defaultParams(algorithmOf("fot")), ...patch });
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
    const withLab = toConfig(draft({ clientOverrides: { [AMC.participantId]: "lab:m1" } }))!;
    expect(estimate(withLab, BUILTIN_DATASETS, [...priced, LAB]).cost).toBeNull();
    expect(estimate(config, BUILTIN_DATASETS, DEFAULT_ENDPOINTS).cost).toBeNull();
  });

  it("uploads less when the algorithm's per-sample cap is lower", () => {
    const base = estimate(toConfig(draft({ mode: "full" }))!, BUILTIN_DATASETS, DEFAULT_ENDPOINTS);
    const capped = estimate(toConfig(draft({ mode: "full", params: { ...defaultParams(algorithmOf("fot")), maxTracesPerItem: 1 } }))!, BUILTIN_DATASETS, DEFAULT_ENDPOINTS);
    expect(capped.serverTokens).toBeLessThan(base.serverTokens);
  });
});

describe("params", () => {
  it("come from the algorithm's registry entry, not from fixed task fields", () => {
    const fot = algorithmOf("fot");
    expect(defaultParams(fot)).toEqual({ insightTarget: "paper-auto", traceDensity: "native", maxTracesPerItem: null, aggregationRetries: 5 });
    const retries = fot.params.find((def) => def.key === "aggregationRetries")!;
    expect(paramText(retries, {})).toBe("5 次");
    expect(toConfig(draft({ params: {} }))!.params).toEqual(defaultParams(fot));
  });
});

describe("draft", () => {
  it("lists what is missing in page order", () => {
    const empty = withDefaults({});
    expect(draftIssues(empty, BUILTIN_DATASETS, BUILTIN_PARTICIPANTS, DEFAULT_ENDPOINTS).map((issue) => issue.field)).toEqual(["scenario"]);
    const planned = withDefaults({ scenario: "vertical" });
    expect(draftIssues(planned, BUILTIN_DATASETS, BUILTIN_PARTICIPANTS, DEFAULT_ENDPOINTS)[0].message).toContain("规划中");
    const one = draft({ participants: [AMC], serverModel: "missing:model" });
    const issues = draftIssues(one, BUILTIN_DATASETS, BUILTIN_PARTICIPANTS, DEFAULT_ENDPOINTS);
    expect(issues.map((issue) => issue.field)).toEqual(["participants", "models"]);
    expect(issues[0].message).toBe("至少选 2 个参与方");
    expect(draftIssues(draft(), BUILTIN_DATASETS, BUILTIN_PARTICIPANTS, DEFAULT_ENDPOINTS)).toEqual([]);
    // 默认走预留的 LLM 接口，接口还没配置也能创建任务。
    expect(draft().clientModel).toBe("default");
  });

  it("asks for scenario, task type, algorithm and participants in turn, selecting nothing on the user's behalf", () => {
    const horizontal = chooseScenario(DEFAULT_DRAFT, "horizontal");
    expect([horizontal.taskType, horizontal.algorithm]).toEqual([null, null]);
    expect(draftIssues(horizontal, BUILTIN_DATASETS, BUILTIN_PARTICIPANTS, DEFAULT_ENDPOINTS)[0].field).toBe("taskType");
    const typed = chooseTaskType(horizontal, "math-reasoning");
    expect(draftIssues(typed, BUILTIN_DATASETS, BUILTIN_PARTICIPANTS, DEFAULT_ENDPOINTS)[0].field).toBe("algorithm");
    const chosen = chooseAlgorithm(typed, "fot");
    expect(chosen.participants).toEqual([]);
    expect(chosen.params).toEqual(defaultParams(algorithmOf("fot")));
    expect(draftIssues(chosen, BUILTIN_DATASETS, BUILTIN_PARTICIPANTS, DEFAULT_ENDPOINTS)[0].field).toBe("participants");
    const vertical = chooseScenario(setParticipants(chosen, ALL), "vertical");
    expect([vertical.taskType, vertical.algorithm, vertical.participants, vertical.params]).toEqual([null, null, [], {}]);
  });

  it("keeps one dataset per participant and swaps it in place", () => {
    const second: Dataset = { ...BUILTIN_DATASETS[2], id: "ds-amc-2", name: "AMC 补充", source: "upload" };
    const picked = pickDataset(pickDataset(draft({ participants: [] }), AMC.participantId, AMC.datasetId), "p-a", "ds-aime24");
    const swapped = pickDataset(picked, AMC.participantId, second.id);
    expect(swapped.participants).toEqual([{ participantId: AMC.participantId, datasetId: second.id }, { participantId: "p-a", datasetId: "ds-aime24" }]);
    expect(pickDataset(swapped, AMC.participantId, null).participants.map((item) => item.participantId)).toEqual(["p-a"]);
    expect(setParticipants(swapped, [AMC, { participantId: AMC.participantId, datasetId: second.id }]).participants).toEqual([AMC]);
  });

  it("only lets in datasets registered for the task's scenario and task type, held by online participants", () => {
    const other: Dataset = { ...BUILTIN_DATASETS[0], id: "ds-other", participantId: "p-a", scenario: "vertical" };
    const offline = BUILTIN_PARTICIPANTS.map((participant) => (participant.id === AMC.participantId ? { ...participant, status: "offline" as const } : participant));
    const mixed = draft({ participants: [{ participantId: "p-a", datasetId: "ds-other" }, AMC, { participantId: "p-b", datasetId: "ds-aime25" }] });
    expect(joinable(mixed, [...BUILTIN_DATASETS, other], offline)).toEqual([{ participantId: "p-b", datasetId: "ds-aime25" }]);
    // 数据集必须属于这个参与方。
    expect(joinable(draft({ participants: [{ participantId: "p-b", datasetId: "ds-amc" }] }), BUILTIN_DATASETS, BUILTIN_PARTICIPANTS)).toEqual([]);
  });

  it("drops per-participant models of deselected participants", () => {
    const withOverride = draft({ clientOverrides: { [AMC.participantId]: "lab:m1" } });
    const deselected = pickDataset(withOverride, AMC.participantId, null);
    expect(activeOverrides(deselected)).toEqual({});
    expect(toConfig(deselected)?.clientOverrides).toEqual({});
  });

  it("names tasks by what they do (task type) and time, not by the algorithm", () => {
    const at = new Date(2026, 8, 28, 16, 36);
    expect(defaultTaskName(draft({ mode: "trial" }), at)).toBe("数学推理任务 09-28 16:36");
    expect(defaultTaskName(withDefaults({}), at)).toBe("联邦任务 09-28 16:36");
  });
});

describe("models", () => {
  it("labels the default endpoint by its current name and lists each model once", () => {
    expect(modelLabel("default", DEFAULT_ENDPOINTS)).toBe("默认 LLM 接口（待配置）");
    const renamed: Endpoint[] = [{ ...DEFAULT_ENDPOINTS[0], name: "实验室网关", baseUrl: "http://x/v1", models: ["m1", "m2"] }];
    expect(modelLabel("default", renamed)).toBe("实验室网关 · m1");
    expect(modelOptions(renamed).map((option) => option.ref)).toEqual(["default", "default:m2"]);
  });
});
