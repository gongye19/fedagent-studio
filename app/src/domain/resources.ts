/**
 * 数据来源、数据集与 LLM 接口。参与方是底层数据分组／旧客户端边界，不要求用户先建机构。
 * hosting 描述数据存放与旧客户端方式；任务执行器单独选择内置流程或 Agent API。
 * 已上传的样本可按步骤授权发送给所选 Agent，不能因此承诺原始数据不出来源环境。
 * 数据按任务类型与规范匹配，可用于兼容场景；本地客户端仍只上报样本索引和交换内容。
 */
import type { components } from "../api/schema";
import { taskTypesFor, type Algorithm, type ScenarioId, type TaskType } from "./catalog";

/** 未检查接口可进入真实测试；已明确不兼容的接口不出现在算法选择中。 */
export function compatibleAgents(agents: readonly components["schemas"]["AgentOut"][], algorithm: Algorithm | null) {
  if (!algorithm) return [];
  const steps = algorithm.stages.filter((step) => step.side === "participant");
  return agents.filter((agent) => {
    if (!agent.capabilities) return true;
    const capability = agent.capabilities.algorithms[algorithm.id];
    return capability?.version === algorithm.version && steps.every((step) => capability.steps.includes(step.id));
  });
}

export type Hosting = "platform" | "local";
export type ResourceSpace = "workspace" | "public";
export type ParticipantStatus = "online" | "offline" | "waiting";

export type Participant = components["schemas"]["ParticipantOut"];

/**
 * 数据集：source 为 builtin（内置数据）、upload（上传到平台）、local（留在参与方本地，只登记名称和说明）。
 * ready：平台托管的已有样本文件；本地的已由客户端上报样本数。没有 ready 的不能选入任务。
 */
export type Dataset = components["schemas"]["DatasetOut"];

/** 模型接口：OpenAI 兼容（kind 为 openai）或测试用的假模型（fake）。密钥只能写入、不能读出，这里只有 hasKey。 */
export type Endpoint = components["schemas"]["EndpointOut"];

export const DATA_LOCATION_LABELS: Record<Hosting, string> = { platform: "平台存储", local: "来源本地" };

export const HOSTING_LABELS: Record<Hosting, string> = {
  platform: "平台运行",
  local: "本地客户端",
};

export const PARTICIPANT_STATUS: Record<ParticipantStatus, string> = {
  online: "在线",
  offline: "离线",
  waiting: "等待连接",
};

/**
 * 预留的默认 LLM 接口：OpenAI 兼容，具体服务和模型由用户在"模型接口"里配置。
 * 任务默认用它（模型引用写作 DEFAULT_MODEL）；需要时可以另外登记接口，给某些参与方单独指定。
 */
export const DEFAULT_ENDPOINT_ID = "default";
export const DEFAULT_MODEL = "default";

/** 填了地址和模型才算配置好；测试用的假模型总是可用。 */
export function isConfigured(endpoint: Endpoint): boolean {
  return endpoint.configured;
}

/** 默认接口的显示名跟着接口名称走，改名后各处一起变。 */
function defaultModelLabel(endpoints: readonly Endpoint[], withStatus = true): string {
  const endpoint = endpoints.find((item) => item.id === DEFAULT_ENDPOINT_ID);
  const name = endpoint?.name || "默认 LLM 接口";
  if (endpoint && isConfigured(endpoint)) return `${name} · ${endpoint.models[0]}`;
  return withStatus ? `${name}（待配置）` : name;
}

/** 模型引用写成"接口 id:模型名"（或 DEFAULT_MODEL），任务里只保存引用。 */
export function modelRef(endpointId: string, model: string): string {
  return `${endpointId}:${model}`;
}

export function parseModelRef(ref: string): { endpointId: string; model: string } | null {
  const index = ref.indexOf(":");
  if (index <= 0 || index === ref.length - 1) return null;
  return { endpointId: ref.slice(0, index), model: ref.slice(index + 1) };
}

/** 可选的模型。默认接口的第一个模型就是"默认"那一项，不再重复列出。 */
export function modelOptions(endpoints: readonly Endpoint[]): { ref: string; label: string }[] {
  return [
    ...(endpoints.some((endpoint) => endpoint.id === DEFAULT_ENDPOINT_ID && endpoint.models.length) ? [{ ref: DEFAULT_MODEL, label: defaultModelLabel(endpoints) }] : []),
    ...endpoints.flatMap((endpoint) => endpoint.models
      .filter((_, index) => !(endpoint.id === DEFAULT_ENDPOINT_ID && index === 0))
      .map((model) => ({ ref: modelRef(endpoint.id, model), label: `${model} · ${endpoint.name}` }))),
  ];
}

/** 试用只使用已配置接口，默认接口缺失或未配置时不会误选它。 */
export function usableModelOptions(endpoints: readonly Endpoint[]) {
  return modelOptions(endpoints).filter((option) => {
    const endpoint = endpointOf(option.ref, endpoints);
    return endpoint && isConfigured(endpoint);
  });
}

/**
 * 模型的显示名。新建任务、试用这些"现在要用"的地方带上"（待配置）"；
 * 已创建任务的配置快照传 withStatus: false，只写用的是哪个接口。
 */
export function modelLabel(ref: string, endpoints: readonly Endpoint[], { withStatus = true }: { withStatus?: boolean } = {}): string {
  if (ref === DEFAULT_MODEL) return defaultModelLabel(endpoints, withStatus);
  const parsed = parseModelRef(ref);
  if (!parsed) return ref;
  const endpoint = endpoints.find((item) => item.id === parsed.endpointId);
  return endpoint ? `${parsed.model} · ${endpoint.name}` : parsed.model;
}

export function endpointOf(ref: string, endpoints: readonly Endpoint[]): Endpoint | undefined {
  if (ref === DEFAULT_MODEL) return endpoints.find((item) => item.id === DEFAULT_ENDPOINT_ID);
  const parsed = parseModelRef(ref);
  return parsed ? endpoints.find((item) => item.id === parsed.endpointId) : undefined;
}

/** 持有方在线、样本已就绪的数据才能参加任务（本地参与方连上客户端之前是"等待连接"）。 */
export function usable(dataset: Dataset, participants: readonly Participant[]): boolean {
  const owner = participants.find((item) => item.id === dataset.participantId);
  return owner?.status === "online" && dataset.ready;
}

/** 样本还没就绪的数据集在等什么：本地的等客户端连上后上报，平台托管的等导入样本文件。 */
export function pendingNote(dataset: Dataset): string {
  return dataset.source === "local" ? "待上报" : "待导入";
}

/** 数据集能不能用于某个场景、某种任务类型的联邦任务。 */
export function fits(dataset: Dataset, scenario: ScenarioId, taskType: TaskType): boolean {
  return dataset.taskType === taskType && taskTypesFor(scenario).includes(taskType);
}
