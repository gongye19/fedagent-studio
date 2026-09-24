import { describe, expect, test } from "vitest";
import {
  capabilityMatrix, mergeability, narrowArtifacts, narrowEvaluations, narrowMethods,
  narrowPrivacies, validateRecipe,
} from "./compatibility";
import { METHODS, PRIVACIES, methodOf, privacyOf } from "./registry";
import { SEED_ARTIFACTS, artifactOf } from "./repository";
import type { Artifact } from "./types";

const pick = (id: string) => {
  const found = artifactOf(SEED_ARTIFACTS, id);
  if (!found) throw new Error(`种子数据里没有 ${id}`);
  return found;
};

// ── C2 产物兼容性 ───────────────────────────────────────────

describe("C2 产物能不能一起合并", () => {
  test("同架构同基座可以合", () => {
    expect(mergeability(pick("news-summary"), pick("legal-qa")).ok).toBe(true);
  });

  test("架构不同不能合，且说明要求的是什么", () => {
    const verdict = mergeability(pick("news-summary"), pick("legal-retrieval-qwen"));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("架构不同");
    expect(verdict.reason).toContain("llama-3.1-8b");
    expect(verdict.reason).toContain("qwen2.5-7b");
  });

  test("同架构不同基座也不能合", () => {
    // 构造一个同架构、不同基座的产物：现实里 Llama-3.1-8B 与其继任版本就是这种关系。
    const sibling: Artifact = { ...pick("legal-qa"), id: "sibling", baseCheckpoint: "Llama-3.1-8B-Base" };
    const verdict = mergeability(pick("news-summary"), sibling);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("基座不同");
  });

  test("对象类型不同不能合", () => {
    const verdict = mergeability(pick("news-summary"), pick("cards-internal"));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("对象类型不同");
  });

  test("选中第一个产物后，列表只留能与它合并的", () => {
    const { allowed, blocked } = narrowArtifacts(SEED_ARTIFACTS, ["news-summary"]);
    expect(allowed.map((item) => item.id).sort()).toEqual(
      ["finance-report", "gov-writing", "legal-qa", "mine-legal", "news-summary", "retail-support"],
    );
    // 被排除的每一条都必须带原因，界面不许只置灰。
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((item) => item.reason.length > 0)).toBe(true);
  });

  test("一个都没选时不收窄", () => {
    expect(narrowArtifacts(SEED_ARTIFACTS, []).allowed).toHaveLength(SEED_ARTIFACTS.length);
  });
});

// ── C1 方法与加密的互斥 ─────────────────────────────────────

describe("C1 方法收窄", () => {
  test("经验卡只能用经验卡合并，LoRA 的方法全部被排除", () => {
    const { allowed, blocked } = narrowMethods([pick("cards-internal"), pick("cards-surgery")]);
    expect(allowed.map((item) => item.id)).toEqual(["card-merge"]);
    expect(blocked.every((item) => item.reason.includes("处理不了"))).toBe(true);
  });

  test("秩不同时要求同秩的方法被排除，并指出改用拼接", () => {
    const { allowed, blocked } = narrowMethods([pick("news-summary"), pick("gov-writing")]);
    expect(allowed.map((item) => item.id)).toEqual(["lora-concat"]);
    const ties = blocked.find((item) => item.item.id === "ties");
    expect(ties?.reason).toContain("同秩");
    expect(ties?.reason).toContain("LoRA 拼接");
  });

  test("秩相同时同秩方法都可用", () => {
    const { allowed } = narrowMethods([pick("news-summary"), pick("legal-qa")]);
    expect(allowed.map((item) => item.id).sort()).toEqual(
      ["dare", "lora-concat", "task-arithmetic", "ties", "weighted-average"],
    );
  });
});

describe("C1 加密收窄", () => {
  test("TIES 配不了安全聚合，因为它要比较大小", () => {
    const { allowed, blocked } = narrowPrivacies(methodOf("ties"));
    expect(allowed.map((item) => item.id).sort()).toEqual(["dp", "none", "redaction", "tee"]);
    const secagg = blocked.find((item) => item.item.id === "secagg");
    expect(secagg?.reason).toContain("比较");
    expect(secagg?.reason).toContain("安全聚合");
  });

  test("TIES 配不了同态加密", () => {
    const blocked = narrowPrivacies(methodOf("ties")).blocked;
    expect(blocked.map((item) => item.item.id).sort()).toEqual(["he-ckks", "secagg"]);
  });

  test("加权平均是纯加法，所有保护方式都配得上", () => {
    expect(narrowPrivacies(methodOf("weighted-average")).blocked).toHaveLength(0);
  });

  test("DARE 的随机掩码与取值无关，所以密文下也能做", () => {
    const allowed = narrowPrivacies(methodOf("dare")).allowed.map((item) => item.id);
    expect(allowed).toContain("he-ckks");
    expect(allowed).toContain("secagg");
  });

  test("经验卡去重要读内容，只有不加密、脱敏和可信执行环境配得上", () => {
    const { allowed, blocked } = narrowPrivacies(methodOf("card-merge"));
    expect(allowed.map((item) => item.id).sort()).toEqual(["none", "redaction", "tee"]);
    expect(blocked.map((item) => item.item.id).sort()).toEqual(["dp", "he-ckks", "secagg"]);
    expect(blocked.find((item) => item.item.id === "dp")?.reason).toContain("噪声");
  });

  test("可信执行环境能配所有方法", () => {
    for (const method of METHODS) {
      expect(narrowPrivacies(method).allowed.map((item) => item.id)).toContain("tee");
    }
  });
});

describe("C1 矩阵里每一条互斥都有可读原因", () => {
  const matrix = capabilityMatrix();

  test("矩阵覆盖所有方法与所有加密方式", () => {
    expect(matrix).toHaveLength(METHODS.length);
    expect(matrix[0].cells).toHaveLength(PRIVACIES.length);
  });

  test("每个不可用的格子都给出原因，且原因里不出现内部标识", () => {
    const rejected = matrix.flatMap((row) => row.cells.filter((cell) => !cell.ok));
    expect(rejected.length).toBeGreaterThan(0);
    for (const cell of rejected) {
      expect(cell.reason).toBeTruthy();
      // 原因是给人读的，不许把 id 直接甩出来。
      expect(cell.reason).not.toMatch(/he-ckks|secagg|content-aware|additive-masked|computeKind/);
      // 必须给一条出路。
      expect(cell.reason).toMatch(/改用|换成/);
    }
  });

  test("可用的格子不带原因", () => {
    const ok = matrix.flatMap((row) => row.cells.filter((cell) => cell.ok));
    expect(ok.every((cell) => cell.reason === null)).toBe(true);
  });
});

describe("C1 评测收窄", () => {
  test("领域评测套件评不了经验卡", () => {
    const { allowed, blocked } = narrowEvaluations([pick("cards-internal")]);
    expect(allowed.map((item) => item.id).sort()).toEqual(["case-replay", "central-benchmark", "federated-eval"]);
    expect(blocked.map((item) => item.item.id)).toEqual(["domain-suite"]);
  });

  test("病例回放评不了 LoRA", () => {
    const { blocked } = narrowEvaluations([pick("news-summary")]);
    expect(blocked.map((item) => item.item.id)).toEqual(["case-replay"]);
  });
});

// ── 提交前复核 ──────────────────────────────────────────────

describe("配方整体复核", () => {
  const legal = {
    artifactIds: ["news-summary", "legal-qa"],
    methodId: "ties",
    privacyId: "dp",
    datasetId: "ft-general",
    evaluationId: "central-benchmark",
  };

  test("合法配方无错误", () => {
    expect(validateRecipe(legal, SEED_ARTIFACTS)).toEqual([]);
  });

  test("不兼容的产物组合被拦下", () => {
    const errors = validateRecipe({ ...legal, artifactIds: ["news-summary", "legal-retrieval-qwen"] }, SEED_ARTIFACTS);
    expect(errors.some((error) => error.includes("架构不同"))).toBe(true);
  });

  test("方法与加密不兼容被拦下", () => {
    const errors = validateRecipe({ ...legal, privacyId: "secagg" }, SEED_ARTIFACTS);
    expect(errors).toContain("所选加密方式与联邦方法不兼容。");
  });

  test("只选一个产物被拦下", () => {
    const errors = validateRecipe({ ...legal, artifactIds: ["news-summary"] }, SEED_ARTIFACTS);
    expect(errors).toContain("至少要选两个产物才能联邦。");
  });

  test("评测方案不适用被拦下", () => {
    const errors = validateRecipe({ ...legal, evaluationId: "case-replay" }, SEED_ARTIFACTS);
    expect(errors).toContain("所选评测方案不适用于当前产物。");
  });
});

describe("注册表自身的一致性", () => {
  test("每个方法引用的后端都存在声明", () => {
    expect(METHODS.every((method) => method.backend.length > 0)).toBe(true);
  });

  test("每种加密方式至少支持一类计算", () => {
    expect(PRIVACIES.every((privacy) => privacy.supports.length > 0)).toBe(true);
  });

  test("拒绝文案里用的是方法与加密的中文名", () => {
    const reason = narrowPrivacies(methodOf("card-merge")).blocked[0].reason;
    expect(reason).toContain("经验卡去重合并");
    expect(PRIVACIES.some((privacy) => reason.includes(privacy.name))).toBe(true);
    expect(privacyOf("secagg")?.name).toBe("安全聚合");
  });
});

// ── 方法优先的收窄（界面是先选方法再选数据） ────────────────

describe("C1/C2 选了方法之后数据列表怎么收窄", () => {
  test("选了经验卡合并，LoRA 全部被排除", () => {
    const { allowed, blocked } = narrowArtifacts(SEED_ARTIFACTS, [], methodOf("card-merge"));
    expect(allowed.every((item) => item.objectType === "skill-cards")).toBe(true);
    expect(allowed).toHaveLength(4);
    expect(blocked.every((item) => item.reason.includes("处理不了"))).toBe(true);
  });

  test("选了 LoRA 的方法，经验卡全部被排除", () => {
    const { allowed } = narrowArtifacts(SEED_ARTIFACTS, [], methodOf("ties"));
    expect(allowed.every((item) => item.objectType === "lora")).toBe(true);
  });

  test("要求同秩的方法会把不同秩的数据拦下，并说清是哪两个秩", () => {
    const { allowed, blocked } = narrowArtifacts(SEED_ARTIFACTS, ["news-summary"], methodOf("ties"));
    expect(allowed.map((item) => item.id)).not.toContain("gov-writing");
    const gov = blocked.find((item) => item.item.id === "gov-writing");
    expect(gov?.reason).toContain("同秩");
    expect(gov?.reason).toContain("秩 16");
    expect(gov?.reason).toContain("秩 32");
  });

  test("不要求同秩的方法不拦秩 32", () => {
    const { allowed } = narrowArtifacts(SEED_ARTIFACTS, ["news-summary"], methodOf("lora-concat"));
    expect(allowed.map((item) => item.id)).toContain("gov-writing");
  });

  test("秩的要求来自方法本身，没选方法时不拦", () => {
    const { allowed } = narrowArtifacts(SEED_ARTIFACTS, ["news-summary"]);
    expect(allowed.map((item) => item.id)).toContain("gov-writing");
  });

  test("架构不同仍然拦得住，与选了哪个方法无关", () => {
    for (const id of ["ties", "lora-concat", "weighted-average"]) {
      const { allowed } = narrowArtifacts(SEED_ARTIFACTS, ["news-summary"], methodOf(id));
      expect(allowed.map((item) => item.id)).not.toContain("legal-retrieval-qwen");
    }
  });
});
