/**
 * 测试用的数据：注册表取自后端（src/test/registry.json，由 fedagent 的注册表导出），参与方、数据集、接口和任务是手写的小例子。
 * 导入这个文件时就装好注册表。
 */
import type { components } from "../api/schema";
import { installRegistry } from "../domain/catalog";
import type { Dataset, Endpoint, Participant } from "../domain/resources";
import type { Task } from "../domain/task";
import registry from "./registry.json";

installRegistry(registry as unknown as components["schemas"]["RegistryOut"]);

const participant = (id: string, name: string, extra: Partial<Participant> = {}): Participant => ({
  id, name, org: "内置数据", intro: "", hosting: "platform", status: "online", builtin: true, lastSeenAt: null, clientPlugins: {}, ...extra,
});

const dataset = (id: string, participantId: string, extra: Partial<Dataset> = {}): Dataset => ({
  id, name: id.replace(/^ds-/, "").toUpperCase(), participantId, description: "", origin: null, scenario: "horizontal",
  taskType: "math-reasoning", schemaVersion: "1.0", sourceHash: null, resourceSpace: "public", count: 30, answered: 30, source: "builtin", sample: null, ready: true, ...extra,
});

export const PARTICIPANTS: Participant[] = [
  participant("p-a", "参与方 A"),
  participant("p-b", "参与方 B"),
  participant("p-c", "参与方 C"),
  participant("p-local", "示例合作方", { hosting: "local", status: "waiting", builtin: false }),
];

export const DATASETS: Dataset[] = [
  dataset("ds-aime24", "p-a"),
  dataset("ds-aime25", "p-b"),
  dataset("ds-amc", "p-c", { count: 46, answered: 46, ready: false }),
  dataset("ds-local", "p-local", { source: "local", count: 0, answered: 0, ready: false }),
  dataset("ds-other", "p-a", { taskType: "other-type" }),
];

export const ENDPOINTS: Endpoint[] = [
  { id: "default", resourceSpace: "public", name: "默认 LLM 接口", kind: "openai", baseUrl: "", models: [], concurrency: 8, price: null, hasKey: false, builtin: true, configured: false, timeout: 600, maxRetries: 8 },
  { id: "fake", resourceSpace: "public", name: "测试用假模型", kind: "fake", baseUrl: "", models: ["fake"], concurrency: 16, price: null, hasKey: false, builtin: true, configured: true, timeout: 600, maxRetries: 8 },
  { id: "ep-1", resourceSpace: "workspace", name: "实验室模型", kind: "openai", baseUrl: "https://llm.example/v1", models: ["m1", "m2"], concurrency: 8, price: 2, hasKey: true, builtin: false, configured: true, timeout: 600, maxRetries: 8 },
];

/** 已完成的 3 轮任务：A 从 10 题对 3 到对 6，B 从对 5 降到对 4（负迁移）。 */
export function completedTask(extra: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    name: "数学推理任务 10-02 12:00",
    createdAt: "2026-10-02T04:00:00Z",
    startedAt: "2026-10-02T04:00:01Z",
    finishedAt: "2026-10-02T04:30:00Z",
    config: {
      scenario: "horizontal", taskType: "math-reasoning", algorithm: "fot",
      participants: [{ participantId: "p-a", datasetId: "ds-aime24" }, { participantId: "p-b", datasetId: "ds-aime25" }],
      clientModel: "fake:fake", clientOverrides: {}, serverModel: "fake:fake", rounds: 3, mode: "trial", trialCap: 10,
      params: {}, seed: 0, workers: 8,
    },
    members: [
      { participantId: "p-a", participant: "参与方 A", datasetId: "ds-aime24", dataset: "AIME24", hosting: "platform", problems: 10, answered: 10, model: "fake:fake" },
      { participantId: "p-b", participant: "参与方 B", datasetId: "ds-aime25", dataset: "AIME25", hosting: "platform", problems: 10, answered: 10, model: "fake:fake" },
    ],
    status: "completed",
    error: null,
    cursor: null,
    rounds: [
      { round: 1, correct: { "p-a": 3, "p-b": 5 }, uploads: { "p-a": 12, "p-b": 9 }, tokens: 1000, output: { builtAfterRound: 1, items: [{ key: "insight_a", text: "A" }], uploadCount: 21 } },
      { round: 2, correct: { "p-a": 5, "p-b": 5 }, uploads: { "p-a": 10, "p-b": 8 }, tokens: 900, output: { builtAfterRound: 2, items: [{ key: "insight_a", text: "A" }, { key: "insight_b", text: "B" }], uploadCount: 18 } },
      { round: 3, correct: { "p-a": 6, "p-b": 4 }, uploads: { "p-a": 9, "p-b": 9 }, tokens: 800, output: { builtAfterRound: 3, items: [{ key: "insight_b", text: "B" }], uploadCount: 18 } },
    ],
    fake: true,
    cost: null,
    ...extra,
  };
}
