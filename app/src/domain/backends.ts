// L5 runner 适配器。demo 阶段全部是假执行：按真实量级声明耗时，再压缩到演示时长。
//
// 诚实要求：每一步都同时给出「真实要多久」和「这里放了多久」，界面必须把前者显示出来。
// 演示里 10 秒跑完的事情，真跑是几小时——不标清楚就是在骗人。
//
// 新增一个联邦方法时改这个文件和 registry.ts，编排层（run.ts）零改动（C5）。

import { METRIC_KEYS } from "./repository";
import type { StageId } from "./run";
import { LORA_FEDERATION_SCENARIO } from "./scenario";
import type { Artifact, Evaluation, Method, Privacy, ResourceClass } from "./types";

export type Context = {
  selected: Artifact[];
  method: Method;
  privacy: Privacy;
  evaluation: Evaluation;
  datasetName: string | null;
};

export type StageWork = {
  /** 真实跑一趟大概多久。显示给用户，不参与计时。 */
  realCost: string;
  /** 演示里实际等多久。 */
  demoMs: number;
  resourceClass: ResourceClass;
  /** 阶段完成后写进 stage.detail 的一句话。 */
  detail: string;
};

export type Backend = {
  id: string;
  name: string;
  plan(stage: StageId, context: Context): StageWork;
  produce(context: Context): { name: string; sizeBytes: number; metrics: Record<string, number> };
};

const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** 方法之间要有可见差异，否则换方法这件事在演示里没有意义。确定性，不用随机数。 */
const METHOD_BONUS: Record<string, number> = {
  "weighted-average": 0,
  "task-arithmetic": 0.012,
  ties: 0.028,
  dare: 0.019,
  "lora-concat": 0.008,
  "card-merge": 0,
};

/** 加密方式对合并耗时的影响。同态加密是大头，而且慢在预处理不在求和。 */
function mergeCost(privacy: Privacy, count: number): { realCost: string; demoMs: number } {
  if (privacy.id === "he-ckks") {
    return {
      realCost: `约 ${Math.round(0.7 * count + 1)} 分钟，其中密文求和不到 1 秒，其余是密钥预处理与转密`,
      demoMs: 3400,
    };
  }
  if (privacy.id === "secagg") {
    return { realCost: `约 ${20 + count * 6} 秒，含各方掩码协商`, demoMs: 2800 };
  }
  if (privacy.id === "tee") {
    return { realCost: `约 ${15 + count * 5} 秒，含飞地证明与密钥注入`, demoMs: 2600 };
  }
  return { realCost: `约 ${10 + count * 6} 秒`, demoMs: 2200 };
}

const mergekit: Backend = {
  id: "mergekit",
  name: "mergekit",
  plan(stage, context) {
    const count = context.selected.length;
    switch (stage) {
      case "preflight":
        return {
          realCost: "秒级",
          demoMs: 800,
          resourceClass: "cpu-small",
          detail: `规则引擎与 Agent 已确认 ${count} 个输入的格式、基座、架构和秩符合场景契约`,
        };
      case "provision":
        return {
          realCost: "约 5 至 15 秒",
          demoMs: 1200,
          resourceClass: "cpu-small",
          detail: `已启动 ${LORA_FEDERATION_SCENARIO.execution.mergeImage}，默认禁止外网访问`,
        };
      case "federate": {
        const cost = mergeCost(context.privacy, count);
        return {
          ...cost,
          resourceClass: context.privacy.resourceClass,
          detail: `在隔离 runner 中以「${context.method.name}」聚合 ${count} 个 LoRA，保护方式为${context.privacy.name}`,
        };
      }
      case "evaluate":
        return {
          realCost: "约 20 至 30 分钟",
          demoMs: 2800,
          resourceClass: context.evaluation.resourceClass,
          detail: `已启动 ${LORA_FEDERATION_SCENARIO.execution.evaluationImage}，按「${context.evaluation.name}」执行质量闸门`,
        };
      case "publish":
        return {
          realCost: "秒级",
          demoMs: 900,
          resourceClass: "cpu-small",
          detail: "固化为不可变版本并写入谱系",
        };
    }
  },
  produce(context) {
    const keys = METRIC_KEYS.lora;
    const valuesOf = (metric: string) => context.selected.map((item) => item.metrics[metric] ?? 0);
    const bonus = METHOD_BONUS[context.method.id] ?? 0;
    const tuned = context.datasetName ? 0.018 : 0;

    const metrics: Record<string, number> = {
      // 合并多个领域提升泛化，这是合并的主要收益。
      综合基准: round(Math.max(...valuesOf("综合基准")) + 0.055 + bonus + tuned),
      // 单一领域被其他领域稀释，相对最好的那个会掉。
      领域准确率: round(mean(valuesOf("领域准确率")) - 0.015 + bonus),
      指令遵循: round(Math.max(...valuesOf("指令遵循")) + 0.014 + bonus + tuned),
      // 最弱的一方把整体拖下来，再往下掉一点——这就是「看起来像正常升级」的失败形态。
      拒答合规: round(Math.min(...valuesOf("拒答合规")) - 0.028 + bonus * 0.4),
    };

    return {
      name: `合并版 · ${context.selected.map((item) => item.domain).join("+")}`,
      sizeBytes: Math.max(...context.selected.map((item) => item.sizeBytes)),
      metrics: Object.fromEntries(keys.map((key) => [key, metrics[key]])),
    };
  },
};

const evomedMerge: Backend = {
  id: "evomed-merge",
  name: "evomed-skill-card-merge v5",
  plan(stage, context) {
    const count = context.selected.length;
    switch (stage) {
      case "preflight":
        return {
          realCost: "秒级",
          demoMs: 700,
          resourceClass: "cpu-small",
          detail: `${count} 份经验卡已通过规则检查与 Agent 语义检查`,
        };
      case "provision":
        return {
          realCost: "约 5 至 15 秒",
          demoMs: 1100,
          resourceClass: "cpu-small",
          detail: "已创建经验卡合并 runner，输入以只读方式挂载",
        };
      case "federate":
        return {
          realCost: "约 10 至 20 秒",
          demoMs: 2400,
          resourceClass: "cpu-small",
          detail: `按签名去重、按语义分组、按有益与有害次数过滤，再与基线按卡片编号合并`,
        };
      case "evaluate":
        return {
          realCost: "约 35 分钟，20 例平均每例 107 秒",
          demoMs: 2600,
          resourceClass: context.evaluation.resourceClass,
          detail: `按「${context.evaluation.name}」逐例回放，并与每份经验卡的既有指标对比`,
        };
      case "publish":
        return {
          realCost: "秒级",
          demoMs: 800,
          resourceClass: "cpu-small",
          detail: "固化为不可变版本并写入谱系",
        };
    }
  },
  produce(context) {
    const keys = METRIC_KEYS["skill-cards"];
    const valuesOf = (metric: string) => context.selected.map((item) => item.metrics[metric] ?? 0);
    const tuned = context.datasetName ? 0.015 : 0;

    const metrics: Record<string, number> = {
      诊断准确率: round(Math.max(...valuesOf("诊断准确率")) + 0.062 + tuned),
      检查项命中: round(Math.max(...valuesOf("检查项命中")) + 0.021 + tuned),
      // 多院经验互相冲突时结论一致性会掉。
      结论一致性: round(mean(valuesOf("结论一致性")) - 0.008),
    };

    return {
      name: `合并版 · 经验卡 ${context.selected.length} 份`,
      sizeBytes: context.selected.reduce((sum, item) => sum + item.sizeBytes, 0),
      metrics: Object.fromEntries(keys.map((key) => [key, metrics[key]])),
    };
  },
};

const BACKENDS: Record<string, Backend> = {
  mergekit,
  "evomed-merge": evomedMerge,
};

export function backendFor(method: Method): Backend {
  const backend = BACKENDS[method.backend];
  if (!backend) throw new Error(`没有注册后端 ${method.backend}`);
  return backend;
}

/** 演示时长总和，用来在开始前告诉用户大概要等多久。 */
export function demoDuration(context: Context): number {
  const backend = backendFor(context.method);
  const stages: StageId[] = ["preflight", "provision", "federate", "evaluate", "publish"];
  return stages
    .reduce((sum, stage) => sum + backend.plan(stage, context).demoMs, 0);
}
