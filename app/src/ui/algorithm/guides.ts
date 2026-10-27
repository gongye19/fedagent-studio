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
    resources: "选择医疗 Agent 服务与同方病例，结合其他方共享资源，任务合计至少两方。",
    process: "基线评测 → 本站学习 → 聚合 → 加载记忆 → 再评测。",
    integration: "本站保存诊断轨迹；平台聚合精简经验，加载确认后独立评测。",
    desktop: diagramAssets.evomedclaw,
    mobile: diagramAssets["evomedclaw-mobile"],
  },
};
