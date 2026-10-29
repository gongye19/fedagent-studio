import diagramAssets from "./diagram-assets.json";

/** Editorial explanations of the pinned integrations, not runtime task state. */
export type AlgorithmGuide = {
  purpose: string;
  resources: string;
  process: string;
  integration: string;
  desktop: { width: number; height: number; sha256: string };
  mobile: { width: number; height: number; sha256: string };
};

export const ALGORITHM_GUIDES: Record<string, AlgorithmGuide> = {
  fot: {
    purpose: "共享解题经验，辅助后续数学推理。",
    resources: "至少两份题库，以及解题和汇总使用的 LLM。",
    process: "解题 → 反思 → 提取经验 → 聚合 → 下一轮回用。",
    integration: "平台提供解题工作流，无需接入 Agent API。",
    desktop: diagramAssets.fot,
    mobile: diagramAssets["fot-mobile"],
  },
  evomedclaw: {
    purpose: "共享诊断过程经验，供医疗 Agent 后续检索。",
    resources: "医疗 Agent 服务、同方病例和评测 LLM；任务合计至少两方，可结合共享资源。",
    process: "无经验评测 → 生成本地经验 → 本地评测 → 聚合 → 联邦评测。",
    integration: "学习病例生成经验，三组使用同一批独立评测病例；共享经验不保证提升。",
    desktop: diagramAssets.evomedclaw,
    mobile: diagramAssets["evomedclaw-mobile"],
  },
};
