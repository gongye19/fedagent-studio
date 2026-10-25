import diagramAssets from "./diagram-assets.json";

/** Editorial explanations of the pinned integrations, not runtime task state. */
export type AlgorithmGuide = {
  purpose: string;
  example: string;
  original: string;
  integration: string;
  desktop: { width: number; height: number };
  mobile: { width: number; height: number };
};

export const ALGORITHM_GUIDES: Record<string, AlgorithmGuide> = {
  fot: {
    purpose: "把各方解题时形成的经验汇总为共享经验库，让后续推理可以参考这些经验。",
    example: "两方分别提供数学题库，使用选定的 LLM 解题；一方提炼出的几何技巧可以进入共享经验库，供另一方后续解题时参考。",
    original: "每方解题、反思并提取文字经验；中心汇总、分析经验关系，再结合上一版经验库生成新版，进入下一轮。标准答案仅用于评分，不进入解题提示。共享的是文字经验，不更新模型权重。",
    integration: "当前支持数学推理，用户选择数据和 LLM，平台提供固定工作流。默认由模型决定经验条数，汇总最多重试 5 次；这与固定版本实验源码的默认设置有差异。",
    desktop: diagramAssets.fot,
    mobile: diagramAssets["fot-mobile"],
  },
  evomedclaw: {
    purpose: "把多个医疗 Agent 的诊断过程提炼为可共享的过程经验卡，再聚合为可检索的医疗经验库。",
    example: "两套医疗系统各提供病例和 Agent API：各自完成问诊、检查与会诊，提炼过程经验卡；聚合后的经验供后续诊断检索。",
    original: "本地医生与病人、检查和专科 Agent 协作完成诊断；运行轨迹编译为过程卡，各站点导出精简更新，中心按签名聚合，再用于后续诊断。上游还包括多专家及持续共演化等可选能力。",
    integration: "当前为横向文本病例适配，需要至少两组不同的 Agent API 与同方病例。采用关键词路由、单专家会诊，未接入影像、语义工具和持续共演化；最终经验需由接入方显式启用。当前病例先上传平台，再交给 Agent 执行，尚非原始病例始终留在接入方的模式。",
    desktop: diagramAssets.evomedclaw,
    mobile: diagramAssets["evomedclaw-mobile"],
  },
};
