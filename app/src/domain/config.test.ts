import { describe, expect, it } from "vitest";
import { DATASETS, ENDPOINTS, PARTICIPANTS } from "../test/fixtures";
import type { AgentEndpoint } from "../api/agents";
import { algorithmOf, defaultParams, paramText } from "./catalog";
import {
  activeOverrides,
  availableDataSources,
  configIssue,
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
import {
  compatibleAgents,
  modelLabel,
  modelOptions,
  type Dataset,
  type Endpoint,
} from "./resources";

it("requires a user Agent for medical and excludes incompatible interfaces from choices", () => {
  const medical = algorithmOf("evomedclaw");
  const selected = chooseAlgorithm(
    withDefaults({
      scenario: "horizontal",
      taskType: "medical-diagnosis",
      algorithm: null,
    }),
    medical.id,
  );
  expect(selected.execution).toBe("agent");
  expect(selected.agentId).toBeNull();
  const agent: AgentEndpoint = {
    id: "a",
    name: "医疗 Agent",
    baseUrl: "https://agent.test",
    hasKey: false,
    revision: 1,
    ownerId: "workspace",
    ownerName: "当前工作区",
    shared: false,
    resourceSpace: "workspace",
    capabilities: {
      protocol: "fedagent-agent/1",
      algorithms: {
        evomedclaw: { version: medical.version, steps: ["diagnose", "learn"] },
      },
    },
  };
  expect(compatibleAgents([agent], medical)).toEqual([agent]);
  expect(compatibleAgents([agent], algorithmOf("fot"))).toEqual([]);
  expect(
    compatibleAgents([{ ...agent, capabilities: null }], medical),
  ).toHaveLength(1);
  expect(
    compatibleAgents(
      [
        {
          ...agent,
          capabilities: {
            protocol: "fedagent-agent/1",
            algorithms: {
              evomedclaw: { version: medical.version, steps: ["diagnose"] },
            },
          },
        },
      ],
      medical,
    ),
  ).toEqual([]);
});

const BOTH: TaskParticipant[] = [
  { participantId: "p-a", datasetId: "ds-aime24" },
  { participantId: "p-b", datasetId: "ds-aime25" },
];

function draft(patch: Partial<Draft> = {}): Draft {
  return withDefaults({
    scenario: "horizontal",
    taskType: "math-reasoning",
    algorithm: "fot",
    participants: BOTH,
    params: defaultParams(algorithmOf("fot")),
    ...patch,
  });
}

describe("params", () => {
  it("come from the algorithm's registry entry (served by the backend plugin), not from fixed task fields", () => {
    const fot = algorithmOf("fot");
    expect(defaultParams(fot)).toEqual({
      insightTarget: "paper-auto",
      traceDensity: "native",
      maxTracesPerItem: null,
      aggregationRetries: 5,
    });
    const retries = fot.params.find((def) => def.key === "aggregationRetries")!;
    expect(paramText(retries, {})).toBe("5 次");
    expect(toConfig(draft({ params: {} }))!.params).toEqual(defaultParams(fot));
    expect(fot.stages.map((stage) => stage.side)).toEqual([
      "participant",
      "participant",
      "participant",
      "server",
      "server",
      "server",
    ]);
  });
});

describe("draft", () => {
  it("keeps compatible resource scopes and client versions in the same admission rules", () => {
    const own = DATASETS.map((d) =>
      d.id === BOTH[0].datasetId
        ? { ...d, resourceSpace: "workspace" as const }
        : d,
    );
    expect(
      availableDataSources(draft(), own, PARTICIPANTS, "workspace").map(
        (c) => c.participant.id,
      ),
    ).toEqual(["p-a"]);
    const local = PARTICIPANTS.map((p) =>
      p.id === "p-a"
        ? {
            ...p,
            hosting: "local" as const,
            clientPlugins: { fot: "incompatible" },
          }
        : p,
    );
    expect(availableDataSources(draft(), own, local, "workspace")).toEqual([]);
    expect(joinable(draft(), own, local)).toEqual([BOTH[1]]);
    expect(
      configIssue({ field: "plugin-window", message: "插件窗口配置无效" }),
    ).toEqual({ field: "params", message: "插件窗口配置无效" });
  });
  it("lists what is missing in page order", () => {
    const empty = withDefaults({});
    expect(
      draftIssues(empty, DATASETS, PARTICIPANTS, ENDPOINTS).map(
        (issue) => issue.field,
      ),
    ).toEqual(["scenario"]);
    const planned = withDefaults({ scenario: "vertical" });
    expect(
      draftIssues(planned, DATASETS, PARTICIPANTS, ENDPOINTS)[0].message,
    ).toContain("规划中");
    const one = draft({
      participants: [BOTH[0]],
      serverModel: "missing:model",
    });
    const issues = draftIssues(one, DATASETS, PARTICIPANTS, ENDPOINTS);
    expect(issues.map((issue) => issue.field)).toEqual([
      "participants",
      "models",
    ]);
    expect(issues[0].message).toBe("至少选择 2 个可用的数据来源");
    expect(draftIssues(draft(), DATASETS, PARTICIPANTS, ENDPOINTS)).toEqual([]);
    expect(draft().clientModel).toBe("default");
  });

  it("asks for scenario, algorithm, task type and data in turn, selecting nothing on the user's behalf", () => {
    const horizontal = chooseScenario(DEFAULT_DRAFT, "horizontal");
    expect([horizontal.taskType, horizontal.algorithm]).toEqual([null, null]);
    expect(
      draftIssues(horizontal, DATASETS, PARTICIPANTS, ENDPOINTS)[0].field,
    ).toBe("algorithm");
    expect(chooseTaskType(horizontal, "math-reasoning")).toBe(horizontal);
    const chosen = chooseAlgorithm(horizontal, "fot");
    expect(chosen.taskType).toBeNull();
    expect(chosen.participants).toEqual([]);
    expect(chosen.params).toEqual(defaultParams(algorithmOf("fot")));
    expect(
      draftIssues(chosen, DATASETS, PARTICIPANTS, ENDPOINTS)[0].field,
    ).toBe("taskType");
    expect(chooseTaskType(chosen, "medical-diagnosis")).toBe(chosen);
    const typed = chooseTaskType(chosen, "math-reasoning");
    expect(typed.algorithm).toBe("fot");
    expect(draftIssues(typed, DATASETS, PARTICIPANTS, ENDPOINTS)[0].field).toBe(
      "participants",
    );
    const vertical = chooseScenario(setParticipants(chosen, BOTH), "vertical");
    expect([
      vertical.taskType,
      vertical.algorithm,
      vertical.participants,
      vertical.params,
    ]).toEqual([null, null, [], {}]);
  });

  it("keeps one dataset per participant and swaps it in place", () => {
    const picked = pickDataset(
      pickDataset(draft({ participants: [] }), "p-b", "ds-aime25"),
      "p-a",
      "ds-aime24",
    );
    const swapped = pickDataset(picked, "p-b", "ds-aime25-new");
    expect(swapped.participants).toEqual([
      { participantId: "p-b", datasetId: "ds-aime25-new" },
      { participantId: "p-a", datasetId: "ds-aime24" },
    ]);
    expect(
      pickDataset(swapped, "p-b", null).participants.map(
        (item) => item.participantId,
      ),
    ).toEqual(["p-a"]);
    expect(
      setParticipants(swapped, [
        BOTH[1],
        { participantId: "p-b", datasetId: "x" },
      ]).participants,
    ).toEqual([BOTH[1]]);
  });

  it("reuses compatible data across scenarios but excludes offline sources and unready files", () => {
    const vertical: Dataset = {
      ...DATASETS[0],
      id: "ds-vertical",
      scenario: "vertical",
    };
    const offline = PARTICIPANTS.map((participant) =>
      participant.id === "p-b"
        ? { ...participant, status: "offline" as const }
        : participant,
    );
    const mixed = draft({
      participants: [
        { participantId: "p-a", datasetId: "ds-vertical" },
        BOTH[1],
        { participantId: "p-c", datasetId: "ds-amc" },
      ],
    });
    // 数据不永久绑定上传时的场景；当前任务类型、来源归属和就绪状态仍校验。
    expect(joinable(mixed, [...DATASETS, vertical], offline)).toEqual([
      mixed.participants[0],
    ]);
    expect(
      joinable(
        mixed,
        [...DATASETS, { ...vertical, taskType: "medical-diagnosis" }],
        offline,
      ),
    ).toEqual([]);
    expect(joinable(draft(), DATASETS, PARTICIPANTS)).toEqual(BOTH);
    // 数据集必须属于这个参与方
    expect(
      joinable(
        draft({
          participants: [{ participantId: "p-b", datasetId: "ds-aime24" }],
        }),
        DATASETS,
        PARTICIPANTS,
      ),
    ).toEqual([]);
  });

  it("allows public trials and requires at least one workspace dataset for a formal run", () => {
    expect(draftIssues(draft(), DATASETS, PARTICIPANTS, ENDPOINTS)).toEqual([]);
    expect(
      draftIssues(draft({ mode: "full" }), DATASETS, PARTICIPANTS, ENDPOINTS)[0]
        .message,
    ).toContain("我的数据");
    const own = DATASETS.map((d) =>
      d.id === BOTH[0].datasetId
        ? { ...d, resourceSpace: "workspace" as const }
        : d,
    );
    expect(
      draftIssues(draft({ mode: "full" }), own, PARTICIPANTS, ENDPOINTS),
    ).toEqual([]);
    expect(joinable(draft(), own, PARTICIPANTS)).toEqual(BOTH);
  });

  it("drops per-participant models of deselected participants", () => {
    const withOverride = draft({ clientOverrides: { "p-b": "ep-1:m1" } });
    const deselected = pickDataset(withOverride, "p-b", null);
    expect(activeOverrides(deselected)).toEqual({});
    expect(toConfig(deselected)?.clientOverrides).toEqual({});
  });

  it("names tasks by what they do (task type) and time, not by the algorithm", () => {
    const at = new Date(2026, 8, 28, 16, 36);
    expect(defaultTaskName(draft({ mode: "trial" }), at)).toBe(
      "数学推理任务 09-28 16:36",
    );
    expect(defaultTaskName(withDefaults({}), at)).toBe("联邦任务 09-28 16:36");
  });
});

describe("models", () => {
  it("labels the default endpoint by its current name and lists each model once", () => {
    expect(modelLabel("default", ENDPOINTS)).toBe("默认 LLM 接口（待配置）");
    const renamed: Endpoint[] = [
      {
        ...ENDPOINTS[0],
        name: "实验室网关",
        baseUrl: "http://x/v1",
        models: ["m1", "m2"],
        configured: true,
      },
    ];
    expect(modelLabel("default", renamed)).toBe("实验室网关 · m1");
    expect(modelOptions(renamed).map((option) => option.ref)).toEqual([
      "default",
      "default:m2",
    ]);
    expect(modelOptions(ENDPOINTS).map((option) => option.ref)).toEqual([
      "fake:fake",
      "ep-1:m1",
      "ep-1:m2",
    ]);
  });
});

it("does not invent a default endpoint and only offers configured models for application trials", async () => {
  const { usableModelOptions } = await import("./resources");
  const custom = {
    ...ENDPOINTS[0],
    id: "custom",
    name: "自定义接口",
    models: ["model"],
    configured: true,
  };
  expect(modelOptions([custom]).map((option) => option.ref)).toEqual([
    "custom:model",
  ]);
  expect(
    usableModelOptions([ENDPOINTS[0], custom]).map((option) => option.ref),
  ).toEqual(["custom:model"]);
  expect(usableModelOptions([])).toEqual([]);
});

it("switches algorithms without retaining incompatible task, data, Agent overrides or parameters", () => {
  const medical = chooseAlgorithm(
    draft({
      execution: "agent",
      agentId: "old",
      agentOverrides: { "p-a": "old" },
      clientOverrides: { "p-a": "old" },
    }),
    "evomedclaw",
  );
  expect(medical).toMatchObject({
    algorithm: "evomedclaw",
    taskType: null,
    participants: [],
    execution: "agent",
    agentId: null,
    agentOverrides: {},
    clientOverrides: {},
  });
  const typed = chooseTaskType(medical, "medical-diagnosis");
  expect(typed.params).toEqual(defaultParams(algorithmOf("evomedclaw")));
  const fot = chooseAlgorithm(typed, "fot");
  expect(fot.execution).toBe("builtin");
  expect(fot.taskType).toBeNull();
  expect(fot.params).toEqual(defaultParams(algorithmOf("fot")));
  expect(
    draftIssues(
      draft({ execution: "agent" }),
      DATASETS,
      PARTICIPANTS,
      ENDPOINTS,
    ).some((i) => i.message.includes("数据与 LLM")),
  ).toBe(true);
});
