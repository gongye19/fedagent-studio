/**
 * 场景与算法注册表。前端只按这里的定义展示和校验，接入后端后改为由后端注册表下发。
 *
 * 场景沿用联邦学习的三分法，落到 Agent 上：
 * - 横向：各方做同一类任务，题目不同；
 * - 纵向：同一批问题，各方掌握不同方面的信息；
 * - 迁移：各方的任务和数据都不同，把已有经验迁移到新领域。
 * 每个算法只属于一个场景。第一版只有横向的 FoT，纵向和迁移的算法待接入。
 */

export type ScenarioId = "horizontal" | "vertical" | "transfer";
export type AlgorithmId = "fot";
export type TaskType = "math-reasoning";
export type GraderId = "math-answer";

export type Scenario = {
  id: ScenarioId;
  name: string;
  summary: string;
  example: string;
  /** 每个参与方需要带来的数据。 */
  dataNeeds: string;
  status: "available" | "planned";
};

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "horizontal",
    name: "横向联邦 Agent",
    summary: "各方的 Agent 做同一类任务，但题目各不相同。各方只上传解题中提炼的经验，服务端汇成洞见库，下一轮大家一起用。",
    example: "8 个数学竞赛题库，各由一个参与方持有",
    dataNeeds: "每方一份同类型的题库",
    status: "available",
  },
  {
    id: "vertical",
    name: "纵向联邦 Agent",
    summary: "面对同一批问题，各方掌握不同方面的信息，要结合起来才能回答，但各方的原始信息不能交出。",
    example: "银行有交易记录、电商有消费记录，共同回答同一批用户的问题",
    dataNeeds: "各方关于同一批对象的不同信息",
    status: "planned",
  },
  {
    id: "transfer",
    name: "联邦迁移 Agent",
    summary: "各方的任务和数据都不相同。把已有参与方的经验迁移给新领域的 Agent，帮它在题目很少时起步。",
    example: "把数学推理的经验迁移到物理题",
    dataNeeds: "源领域的经验和目标领域的少量题目",
    status: "planned",
  },
];

/** FoT 每一轮的 6 步：前三步在参与方，后三步在服务端。 */
export type StageId = "solve" | "reflect" | "extract" | "collect" | "profile" | "library";

export type Stage = {
  id: StageId;
  label: string;
  side: "participant" | "server";
  detail: string;
};

export const FOT_STAGES: readonly Stage[] = [
  { id: "solve", label: "解题", side: "participant", detail: "带上当前洞见库作答；第 1 轮还没有洞见库" },
  { id: "reflect", label: "反思", side: "participant", detail: "回顾自己的解法，找出有效和无效的步骤" },
  { id: "extract", label: "提取 trace", side: "participant", detail: "把可复用的做法和适用条件写成 trace" },
  { id: "collect", label: "汇总", side: "server", detail: "收集本轮所有参与方上传的 trace" },
  { id: "profile", label: "关系分析", side: "server", detail: "把 trace 归类，标出前置、互补、替代等关系" },
  { id: "library", label: "生成洞见库", side: "server", detail: "合并上一版洞见库，生成下一轮使用的版本" },
];

export type Algorithm = {
  id: AlgorithmId;
  scenario: ScenarioId;
  name: string;
  fullName: string;
  summary: string;
  /** 参与方上传给服务端的内容。 */
  uploads: string;
  /** 始终留在参与方的内容。 */
  keeps: string;
  stages: readonly Stage[];
  accepts: readonly TaskType[];
  /** 标准答案只用于评分时为 false：没有答案的题库也能参与。 */
  answersRequired: boolean;
  artifact: string;
  minParticipants: number;
  minRounds: number;
  maxRounds: number;
  source: { paper: string; paperUrl: string; code: string; codeUrl: string };
};

export const ALGORITHMS: readonly Algorithm[] = [
  {
    id: "fot",
    scenario: "horizontal",
    name: "FoT",
    fullName: "Federation over Text",
    summary: "各方把解题中提炼的推理经验（trace）上传，服务端归类、合并成洞见库，下一轮下发给所有参与方。不传模型参数，不需要梯度或标注。",
    uploads: "每道题提炼出的 trace：可复用的做法与适用条件",
    keeps: "题目、标准答案、解答全文、模型与密钥",
    stages: FOT_STAGES,
    accepts: ["math-reasoning"],
    answersRequired: false,
    artifact: "洞见库",
    minParticipants: 2,
    minRounds: 2,
    maxRounds: 6,
    source: {
      paper: "arXiv:2604.16778",
      paperUrl: "https://arxiv.org/abs/2604.16778",
      code: "github.com/dixiyao/FoT",
      codeUrl: "https://github.com/dixiyao/FoT",
    },
  },
];

export const TASK_TYPES: Record<TaskType, { label: string; grader: GraderId }> = {
  "math-reasoning": { label: "数学推理题", grader: "math-answer" },
};

export const GRADERS: Record<GraderId, { label: string; detail: string }> = {
  "math-answer": { label: "数学答案", detail: "抽取 \\boxed{} 里的答案，规范化后与标准答案比较" },
};

export function scenarioOf(id: ScenarioId): Scenario {
  const scenario = SCENARIOS.find((item) => item.id === id);
  if (!scenario) throw new Error(`unknown scenario: ${id}`);
  return scenario;
}

export function algorithmOf(id: AlgorithmId): Algorithm {
  const algorithm = ALGORITHMS.find((item) => item.id === id);
  if (!algorithm) throw new Error(`unknown algorithm: ${id}`);
  return algorithm;
}

export function algorithmsFor(scenario: ScenarioId): Algorithm[] {
  return ALGORITHMS.filter((algorithm) => algorithm.scenario === scenario);
}

export function stageOf(id: StageId): Stage {
  const stage = FOT_STAGES.find((item) => item.id === id);
  if (!stage) throw new Error(`unknown stage: ${id}`);
  return stage;
}
