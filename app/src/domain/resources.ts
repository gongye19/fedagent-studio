/**
 * 参与方、数据集和模型接口。
 *
 * 每份数据集只属于一个参与方，数据只在持有方使用。参与方有两种运行位置：
 * - 平台托管：数据上传到平台，由平台运行这个参与方的 Agent，适合公开数据、演示和算法验证；
 * - 参与方本地：数据和模型密钥留在参与方自己的环境，由参与方运行客户端，只上传 trace。
 * 内置的 8 个数学题库来自 FoT 复现包，每份由一个平台托管的示例参与方持有。
 */
import type { TaskType } from "./catalog";

export type Hosting = "platform" | "local";
export type ParticipantStatus = "online" | "offline" | "waiting";

export type Participant = {
  id: string;
  name: string;
  org: string;
  intro: string;
  hosting: Hosting;
  status: ParticipantStatus;
  builtin?: boolean;
};

export type Dataset = {
  id: string;
  name: string;
  participantId: string;
  description: string;
  taskType: TaskType;
  /** 题目数。 */
  count: number;
  /** 带标准答案的题目数；没有答案的题只参与联邦，不计准确率。 */
  answered: number;
  source: "builtin" | "upload";
  sample?: { question: string; answer?: string };
};

export type Endpoint = {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  concurrency: number;
  /** 元 / 百万 token；未设置时不估算费用。 */
  price: number | null;
};

export const HOSTING_LABELS: Record<Hosting, string> = {
  platform: "平台托管",
  local: "参与方本地",
};

export const PARTICIPANT_STATUS: Record<ParticipantStatus, string> = {
  online: "在线",
  offline: "离线",
  waiting: "等待连接",
};

const BUILTIN = [
  { key: "aime24", name: "AIME24", description: "美国数学邀请赛 AIME 2024", count: 30,
    sample: { question: "Find the largest possible real part of \\[(75+117i)z+\\frac{96+144i}{z}\\]where $z$ is a complex number with $|z|=4$.", answer: "540" } },
  { key: "aime25", name: "AIME25", description: "美国数学邀请赛 AIME 2025", count: 30,
    sample: { question: "Find the sum of all integer bases $b>9$ for which $17_b$ is a divisor of $97_b.$", answer: "70" } },
  { key: "amc", name: "AMC", description: "美国数学竞赛 AMC（LiveMathBench 202412）", count: 46,
    sample: { question: "What is $10! - 7! \\cdot 6!$", answer: "0" } },
  { key: "ccee", name: "CCEE", description: "中国高考数学（LiveMathBench 202412）", count: 44,
    sample: { question: "The mode of the data $2,3,5,5,4$ is ?", answer: "5" } },
  { key: "cnmo", name: "CNMO", description: "中国数学奥林匹克（LiveMathBench 202412）", count: 18,
    sample: { question: "What is the minimum value of $y=\\frac{4^x+1}{2^x+1}$?", answer: "2\\sqrt{2}-2" } },
  { key: "wlpmc", name: "WLPMC", description: "WLPMC 竞赛题（LiveMathBench 202412）", count: 11,
    sample: { question: "For a positive integer $n$, let $f_n(x) = \\cos(x) \\cos(2x) \\cos(3x) \\cdots \\cos(nx)$. Find the smallest $n$ such that $|f_n''(0)| > 2023$.", answer: "n=18" } },
  { key: "v202412hard", name: "V202412Hard", description: "LiveMathBench 202412 难题", count: 21,
    sample: { question: "Given the data 5, 6, $x$, $x$, 8, 9 with an average of 7, then the 40% percentile of this data set is?", answer: "7" } },
  { key: "v202505hard", name: "V202505Hard", description: "LiveMathBench 202505 难题", count: 100,
    sample: { question: "For two numbers $a > b$ from the list $3, 9, 15, 21, 27$, what can you say for certain?" } },
] as const;

export const BUILTIN_PARTICIPANTS: readonly Participant[] = BUILTIN.map((item) => ({
  id: `p-${item.key}`,
  name: item.name,
  org: "内置示例",
  intro: `持有 ${item.description} 题库的示例参与方，由平台托管运行。`,
  hosting: "platform",
  status: "online",
  builtin: true,
}));

export const BUILTIN_DATASETS: readonly Dataset[] = BUILTIN.map((item) => ({
  id: `ds-${item.key}`,
  name: item.name,
  participantId: `p-${item.key}`,
  description: item.description,
  taskType: "math-reasoning",
  count: item.count,
  answered: item.count,
  source: "builtin",
  sample: item.sample,
}));

export const DEFAULT_ENDPOINTS: readonly Endpoint[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["deepseek/deepseek-chat", "google/gemini-2.5-flash"],
    concurrency: 8,
    price: null,
  },
  {
    id: "glm",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-5.1"],
    concurrency: 8,
    price: null,
  },
];

/** 模型引用写成"接口 id:模型名"，任务里只保存引用。 */
export function modelRef(endpointId: string, model: string): string {
  return `${endpointId}:${model}`;
}

export function parseModelRef(ref: string): { endpointId: string; model: string } | null {
  const index = ref.indexOf(":");
  if (index <= 0 || index === ref.length - 1) return null;
  return { endpointId: ref.slice(0, index), model: ref.slice(index + 1) };
}

export function modelOptions(endpoints: readonly Endpoint[]): { ref: string; label: string }[] {
  return endpoints.flatMap((endpoint) => endpoint.models.map((model) => ({
    ref: modelRef(endpoint.id, model),
    label: `${model} · ${endpoint.name}`,
  })));
}

export function modelLabel(ref: string, endpoints: readonly Endpoint[]): string {
  const parsed = parseModelRef(ref);
  if (!parsed) return ref;
  const endpoint = endpoints.find((item) => item.id === parsed.endpointId);
  return endpoint ? `${parsed.model} · ${endpoint.name}` : parsed.model;
}

export function endpointOf(ref: string, endpoints: readonly Endpoint[]): Endpoint | undefined {
  const parsed = parseModelRef(ref);
  return parsed ? endpoints.find((item) => item.id === parsed.endpointId) : undefined;
}

/** 持有方在线的数据才能参加任务（本地参与方连上客户端之前是"等待连接"）。 */
export function usable(dataset: Dataset, participants: readonly Participant[]): boolean {
  const owner = participants.find((item) => item.id === dataset.participantId);
  return owner?.status === "online";
}
