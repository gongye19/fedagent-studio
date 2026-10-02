import { describe, expect, it } from "vitest";
import { DATASETS, ENDPOINTS, PARTICIPANTS } from "../test/fixtures";
import { algorithmOf, defaultParams, paramText } from "./catalog";
import {
  activeOverrides,
  chooseAlgorithm,
  chooseScenario,
  chooseTaskType,
  DEFAULT_DRAFT,
  defaultTaskName,
  draftIssues,
  joinable,
  pickDataset,
  setParticipants,
  toConfig,
  withDefaults,
  type Draft,
  type TaskParticipant,
} from "./config";
import { modelLabel, modelOptions, type Dataset, type Endpoint } from "./resources";

const BOTH: TaskParticipant[] = [{ participantId: "p-a", datasetId: "ds-aime24" }, { participantId: "p-b", datasetId: "ds-aime25" }];

function draft(patch: Partial<Draft> = {}): Draft {
  return withDefaults({ scenario: "horizontal", taskType: "math-reasoning", algorithm: "fot", participants: BOTH, params: defaultParams(algorithmOf("fot")), ...patch });
}

describe("params", () => {
  it("come from the algorithm's registry entry (served by the backend plugin), not from fixed task fields", () => {
    const fot = algorithmOf("fot");
    expect(defaultParams(fot)).toEqual({ insightTarget: "paper-auto", traceDensity: "native", maxTracesPerItem: null, aggregationRetries: 5 });
    const retries = fot.params.find((def) => def.key === "aggregationRetries")!;
    expect(paramText(retries, {})).toBe("5 次");
    expect(toConfig(draft({ params: {} }))!.params).toEqual(defaultParams(fot));
    expect(fot.stages.map((stage) => stage.side)).toEqual(["participant", "participant", "participant", "server", "server", "server"]);
  });
});

describe("draft", () => {
  it("lists what is missing in page order", () => {
    const empty = withDefaults({});
    expect(draftIssues(empty, DATASETS, PARTICIPANTS, ENDPOINTS).map((issue) => issue.field)).toEqual(["scenario"]);
    const planned = withDefaults({ scenario: "vertical" });
    expect(draftIssues(planned, DATASETS, PARTICIPANTS, ENDPOINTS)[0].message).toContain("规划中");
    const one = draft({ participants: [BOTH[0]], serverModel: "missing:model" });
    const issues = draftIssues(one, DATASETS, PARTICIPANTS, ENDPOINTS);
    expect(issues.map((issue) => issue.field)).toEqual(["participants", "models"]);
    expect(issues[0].message).toBe("至少选 2 个参与方");
    expect(draftIssues(draft(), DATASETS, PARTICIPANTS, ENDPOINTS)).toEqual([]);
    expect(draft().clientModel).toBe("default");
  });

  it("asks for scenario, task type, algorithm and participants in turn, selecting nothing on the user's behalf", () => {
    const horizontal = chooseScenario(DEFAULT_DRAFT, "horizontal");
    expect([horizontal.taskType, horizontal.algorithm]).toEqual([null, null]);
    expect(draftIssues(horizontal, DATASETS, PARTICIPANTS, ENDPOINTS)[0].field).toBe("taskType");
    const typed = chooseTaskType(horizontal, "math-reasoning");
    expect(draftIssues(typed, DATASETS, PARTICIPANTS, ENDPOINTS)[0].field).toBe("algorithm");
    const chosen = chooseAlgorithm(typed, "fot");
    expect(chosen.participants).toEqual([]);
    expect(chosen.params).toEqual(defaultParams(algorithmOf("fot")));
    expect(draftIssues(chosen, DATASETS, PARTICIPANTS, ENDPOINTS)[0].field).toBe("participants");
    const vertical = chooseScenario(setParticipants(chosen, BOTH), "vertical");
    expect([vertical.taskType, vertical.algorithm, vertical.participants, vertical.params]).toEqual([null, null, [], {}]);
  });

  it("keeps one dataset per participant and swaps it in place", () => {
    const picked = pickDataset(pickDataset(draft({ participants: [] }), "p-b", "ds-aime25"), "p-a", "ds-aime24");
    const swapped = pickDataset(picked, "p-b", "ds-aime25-new");
    expect(swapped.participants).toEqual([{ participantId: "p-b", datasetId: "ds-aime25-new" }, { participantId: "p-a", datasetId: "ds-aime24" }]);
    expect(pickDataset(swapped, "p-b", null).participants.map((item) => item.participantId)).toEqual(["p-a"]);
    expect(setParticipants(swapped, [BOTH[1], { participantId: "p-b", datasetId: "x" }]).participants).toEqual([BOTH[1]]);
  });

  it("only lets in ready datasets of the task's scenario and task type, held by online participants", () => {
    const vertical: Dataset = { ...DATASETS[0], id: "ds-vertical", scenario: "vertical" };
    const offline = PARTICIPANTS.map((participant) => (participant.id === "p-b" ? { ...participant, status: "offline" as const } : participant));
    const mixed = draft({ participants: [{ participantId: "p-a", datasetId: "ds-vertical" }, BOTH[1], { participantId: "p-c", datasetId: "ds-amc" }] });
    // 场景不同、持有方离线、题目文件还没导入的都不算
    expect(joinable(mixed, [...DATASETS, vertical], offline)).toEqual([]);
    expect(joinable(draft(), DATASETS, PARTICIPANTS)).toEqual(BOTH);
    // 数据集必须属于这个参与方
    expect(joinable(draft({ participants: [{ participantId: "p-b", datasetId: "ds-aime24" }] }), DATASETS, PARTICIPANTS)).toEqual([]);
  });

  it("drops per-participant models of deselected participants", () => {
    const withOverride = draft({ clientOverrides: { "p-b": "ep-1:m1" } });
    const deselected = pickDataset(withOverride, "p-b", null);
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
    expect(modelLabel("default", ENDPOINTS)).toBe("默认 LLM 接口（待配置）");
    const renamed: Endpoint[] = [{ ...ENDPOINTS[0], name: "实验室网关", baseUrl: "http://x/v1", models: ["m1", "m2"], configured: true }];
    expect(modelLabel("default", renamed)).toBe("实验室网关 · m1");
    expect(modelOptions(renamed).map((option) => option.ref)).toEqual(["default", "default:m2"]);
    expect(modelOptions(ENDPOINTS).map((option) => option.ref)).toEqual(["default", "fake:fake", "ep-1:m1", "ep-1:m2"]);
  });
});
