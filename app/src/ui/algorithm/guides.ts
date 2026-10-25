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
    resources: "至少两组不同的医疗 Agent API 及各自的病例数据。",
    process: "诊断 → 提炼经验卡 → 聚合 → 下一轮检索。",
    integration: "仅支持文本病例；病例先上传平台，最终经验由接入方启用。",
    desktop: diagramAssets.evomedclaw,
    mobile: diagramAssets["evomedclaw-mobile"],
  },
};
