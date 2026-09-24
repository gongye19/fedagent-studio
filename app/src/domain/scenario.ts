/**
 * PEFT / LoRA 模拟执行后端的兼容契约。
 *
 * 当前产品 UI 已由 configuration.ts 的通用工作负载注册表驱动；这份常量只为旧的
 * mock runner、样例产物和测试保留，不代表平台完整的配置模型。
 */
export const LORA_FEDERATION_SCENARIO = {
  id: "lora-fedavg-v1",
  name: "LoRA 模型联邦",
  summary: "聚合同一基础模型上的 LoRA 适配器，并在隔离环境中完成评测。",
  federationMethodId: "lora-model-federation",
  federationMethodOptions: [
    { id: "lora-model-federation", label: "LoRA 模型联邦" },
  ],
  dataTypeId: "lora",
  dataTypeOptions: [
    { id: "lora", label: "LoRA 适配器" },
  ],
  privacyOptions: [
    { id: "secagg", label: "安全聚合" },
  ],
  baseModelId: "llama-3.1-8b",
  baseModelOptions: [
    {
      id: "llama-3.1-8b",
      label: "Llama 3.1 8B",
      architecture: "llama-3.1-8b",
      checkpoint: "Llama-3.1-8B-Instruct",
    },
  ],
  methodId: "weighted-average",
  aggregationOptions: [
    { id: "weighted-average", label: "Weighted FedAvg" },
  ],
  rankId: "16",
  rankOptions: [
    { id: "16", label: "16", value: 16 },
  ],
  privacyId: "secagg",
  evaluationId: "domain-suite",
  datasetId: null,
  inputContract: {
    objectType: "lora",
    architecture: "llama-3.1-8b",
    baseCheckpoint: "Llama-3.1-8B-Instruct",
    rank: 16,
    minParticipants: 2,
  },
  sampleArtifactIds: ["news-summary", "legal-qa", "finance-report"],
  execution: {
    mergeImage: "federation/lora-fedavg:0.1",
    evaluationImage: "federation/lora-eval:0.1",
    isolation: "Ephemeral sandbox",
    networkPolicy: "Deny by default",
    mergeResource: "2 vCPU / 8 GB",
    evaluationResource: "1 GPU / 24 GB",
  },
} as const;

export type LoraFederationScenario = typeof LORA_FEDERATION_SCENARIO;
