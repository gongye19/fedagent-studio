/**
 * 示例数据：前端原型模拟运行时生成的准确率、trace 数、洞见库和 token 用量。
 *
 * 全部由任务 id 和数据集 id 确定性地算出，刷新后不变；界面上一律标"示例"，不代表真实运行结果。
 * 接入后端后，这些值改为读取任务运行目录里的检查点文件（solve / trace / library / metrics）。
 * 洞见和 trace 的文字用英文，因为 FoT 的上游提示词是英文，真实输出也是英文。
 */

export type PoolEntry = {
  key: string;
  category: string;
  /** 最常产生这条经验的数据集；空数组表示各方都会产生。 */
  affinity: readonly string[];
  trace: string;
  insight: string;
};

export const INSIGHT_POOL: readonly PoolEntry[] = [
  {
    key: "insight_integrality_by_division", category: "整除与同余", affinity: ["ds-ccee", "ds-amc", "ds-cnmo", "ds-aime25"],
    trace: "When a fraction must be an integer, divide first to split off a constant remainder, then list every divisor of that remainder, including negative ones, and drop values that make the denominator zero.",
    insight: "For integrality conditions, rewrite the expression as a polynomial part plus a constant over the denominator; the denominator must divide the constant. Enumerate positive and negative divisors and re-check domain restrictions.",
  },
  {
    key: "insight_base_conversion_divisibility", category: "整除与同余", affinity: ["ds-aime25", "ds-amc"],
    trace: "Converted numbers written in base b to polynomials in b, then reduced the divisibility condition to a statement about a fixed integer, which limited b to a short list.",
    insight: "Translate base-b or digit-based conditions into polynomials in the base, then reduce divisibility to a condition on a small fixed integer before checking the allowed range of the base.",
  },
  {
    key: "insight_modular_screening", category: "整除与同余", affinity: ["ds-aime24", "ds-cnmo", "ds-v202505hard", "ds-wlpmc"],
    trace: "Checked the equation modulo 3, 4 and 8 before any casework; most residue classes were impossible, leaving two cases to verify.",
    insight: "Before long casework, test small moduli (2, 3, 4, 8, 9) to rule out impossible residues; it often shrinks the search to a few cases that can be checked directly.",
  },
  {
    key: "insight_complementary_counting", category: "计数与组合", affinity: ["ds-aime25", "ds-amc", "ds-v202412hard"],
    trace: "Counting arrangements with at least one adjacent pair was messy, so I counted arrangements with none and subtracted from the total, then verified with n = 3 by listing.",
    insight: "When direct counting splits into many overlapping cases, count the complement or use inclusion-exclusion, and confirm the formula on a small instance you can list by hand.",
  },
  {
    key: "insight_bijection_to_standard_objects", category: "计数与组合", affinity: ["ds-aime24", "ds-wlpmc", "ds-v202505hard"],
    trace: "Mapped each valid sequence to a lattice path from (0,0) to (n,n) that stays above the diagonal, which turned the count into a known formula.",
    insight: "Map the configuration to a standard object (lattice paths, binary strings, stars and bars) and count that instead; check that the map is one-to-one in both directions.",
  },
  {
    key: "insight_generating_functions", category: "计数与组合", affinity: ["ds-v202412hard", "ds-aime25"],
    trace: "Encoded each part's allowed sizes as a polynomial and read the answer off one coefficient of the product.",
    insight: "For counts with several additive constraints, encode each constraint as a factor of a generating function and extract the needed coefficient; it avoids nested casework.",
  },
  {
    key: "insight_symmetry_and_extremes", category: "代数与不等式", affinity: ["ds-cnmo", "ds-wlpmc", "ds-v202505hard", "ds-aime24"],
    trace: "Guessed the extremum by setting the variables equal, then justified it with AM-GM instead of calculus.",
    insight: "For symmetric expressions, locate candidate extrema by assuming an order or equal variables, then prove optimality with AM-GM, Cauchy-Schwarz or convexity rather than trusting the guess.",
  },
  {
    key: "insight_trig_normalization", category: "代数与不等式", affinity: ["ds-ccee", "ds-amc", "ds-wlpmc"],
    trace: "Rewrote the expression in cos 2x using power-reduction identities, which made the period and range immediate.",
    insight: "Normalize trigonometric expressions to a single function of one angle (double-angle, power-reduction, auxiliary angle) before reading off period, range or extrema.",
  },
  {
    key: "insight_substitution_for_exponentials", category: "代数与不等式", affinity: ["ds-cnmo", "ds-ccee", "ds-aime24"],
    trace: "Set t = 2^x > 0 so the expression became a rational function of t, then minimized it on t > 0.",
    insight: "Substitute a new variable for repeated exponential or radical terms, carry the new domain (such as t > 0) forward, and optimize the resulting function on that domain.",
  },
  {
    key: "insight_complex_modulus_parametrization", category: "代数与不等式", affinity: ["ds-aime24", "ds-v202412hard"],
    trace: "Wrote z = 4(cos t + i sin t) so the real part became a linear combination of cos t and sin t, whose maximum is the amplitude.",
    insight: "For complex numbers with fixed modulus, parametrize by angle; expressions reduce to a cos t + b sin t, whose extreme values are plus or minus sqrt(a^2 + b^2).",
  },
  {
    key: "insight_coordinates_with_checks", category: "几何", affinity: ["ds-aime24", "ds-aime25", "ds-amc"],
    trace: "Placed the most constrained vertex at the origin and one side on the x-axis; recomputing a given length caught a sign error.",
    insight: "In geometry with fixed lengths, choose coordinates that pin the most constrained point and side, and recompute one given quantity to catch sign or orientation errors.",
  },
  {
    key: "insight_power_of_a_point", category: "几何", affinity: ["ds-aime25", "ds-v202412hard"],
    trace: "Used power of a point at the chord intersection to get a linear relation between segments instead of solving triangles.",
    insight: "With intersecting chords, secants or tangents, try power of a point before trigonometry; it gives linear relations between segment lengths.",
  },
  {
    key: "insight_recurrence_from_small_cases", category: "数列与递推", affinity: ["ds-v202412hard", "ds-v202505hard", "ds-wlpmc"],
    trace: "Computed the first five terms, noticed a recurrence, and proved it by induction before using it.",
    insight: "Compute small cases, conjecture a recurrence or closed form, then prove it by induction or a combinatorial argument before relying on the pattern.",
  },
  {
    key: "insight_series_for_derivatives", category: "数列与递推", affinity: ["ds-wlpmc", "ds-cnmo"],
    trace: "Expanded each factor as a series near zero; the second derivative came from the sum of the quadratic coefficients.",
    insight: "For derivatives of products at a point, expand each factor as a series (or take logarithms) and collect the needed coefficient instead of differentiating repeatedly.",
  },
  {
    key: "insight_answer_format_check", category: "验证与检查", affinity: [],
    trace: "Re-read the question and noticed it asked for the sum of the valid values, not how many there were.",
    insight: "Before finalizing, re-read what is asked (count or sum, exact form, units, modulo) and make sure the boxed answer matches that format exactly.",
  },
  {
    key: "insight_boundary_sanity_check", category: "验证与检查", affinity: ["ds-amc", "ds-ccee", "ds-cnmo", "ds-v202505hard"],
    trace: "Plugged the boundary value into the derived formula and got a negative count, which exposed a dropped constraint.",
    insight: "Substitute boundary or degenerate values into the final formula; an impossible result points to a constraint that was dropped earlier.",
  },
  {
    key: "insight_switch_after_stall", category: "解题策略", affinity: ["ds-aime24", "ds-v202505hard", "ds-wlpmc", "ds-aime25"],
    trace: "After three steps the algebra kept growing, so I switched to an invariant and finished in two lines.",
    insight: "If an approach keeps producing larger expressions after two or three steps, stop and switch to an invariant, a substitution or a smaller case instead of pushing the algebra further.",
  },
  {
    key: "insight_statistics_definitions", category: "解题策略", affinity: ["ds-ccee", "ds-v202412hard"],
    trace: "Solved for x from the mean first, then sorted the data before applying the percentile definition.",
    insight: "For statistics questions, pin down unknowns from the given summary (mean, total) first, sort the data, then apply the exact textbook definition of percentile, median or mode.",
  },
];

/** 内置数据集第 1 轮（没有洞见库）的示例正确率。 */
export const BASE_RATE: Record<string, number> = {
  "ds-aime24": 0.3,
  "ds-aime25": 0.267,
  "ds-amc": 0.565,
  "ds-ccee": 0.636,
  "ds-cnmo": 0.389,
  "ds-wlpmc": 0.455,
  "ds-v202412hard": 0.333,
  "ds-v202505hard": 0.31,
};

/** 字符串 → [0, 1) 的确定性伪随机数（FNV-1a + 一次混合）。 */
export function unit(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2c1b3c6d);
  hash ^= hash >>> 12;
  return (hash >>> 0) / 4294967296;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function sampleCorrect(taskId: string, datasetId: string, problems: number, round: number, previous?: number): number {
  if (round === 1 || previous === undefined) {
    const rate = BASE_RATE[datasetId] ?? 0.25 + 0.35 * unit(`${taskId}|${datasetId}|base`);
    const jitter = (unit(`${taskId}|${datasetId}|r1`) - 0.5) * Math.min(2, problems * 0.1);
    return clamp(Math.round(rate * problems + jitter), 0, problems);
  }
  const roll = unit(`${taskId}|${datasetId}|r${round}`);
  if (problems <= 10) return clamp(previous + (roll < 0.25 ? -1 : roll > 0.55 ? 1 : 0), 0, problems);
  return clamp(previous + Math.round((roll - 0.35) * 0.12 * problems), 0, problems);
}

export function sampleTraceCount(taskId: string, datasetId: string, problems: number, round: number, perProblem: number, cap: number | null): number {
  const rate = perProblem * (0.85 + 0.3 * unit(`${taskId}|${datasetId}|traces|${round}`));
  return Math.max(1, Math.round(problems * (cap == null ? rate : Math.min(cap, rate))));
}

export type LibrarySize = "paper-auto" | "author-formula" | "fixed-11" | "fixed-37";

const PAPER_AUTO_SIZES = [9, 11, 12, 13, 13, 14, 14];

/** 洞见库条数；示例池只有 INSIGHT_POOL.length 条，超过时按池大小截断。 */
export function librarySize(target: LibrarySize, builtAfterRound: number, traces: number): number {
  const pool = INSIGHT_POOL.length;
  switch (target) {
    case "author-formula":
      return clamp(Math.floor(Math.log10(Math.max(traces, 1)) * 10 + 1), 1, pool);
    case "fixed-11":
      return Math.min(11, pool);
    case "fixed-37":
      return Math.min(37, pool);
    default: {
      const planned = PAPER_AUTO_SIZES[Math.min(builtAfterRound, PAPER_AUTO_SIZES.length) - 1];
      return clamp(Math.min(planned, Math.round(traces / 6)), 4, pool);
    }
  }
}

/** 按与参与方的相关程度给示例池排序；同一任务的各轮版本取同一顺序的前 n 条，所以后一版包含前一版。 */
export function rankedPool(taskId: string, datasetIds: readonly string[]): PoolEntry[] {
  const score = (entry: PoolEntry) => {
    const overlap = entry.affinity.length === 0 ? 1.5 : entry.affinity.filter((id) => datasetIds.includes(id)).length;
    return overlap + unit(`${taskId}|${entry.key}`);
  };
  return [...INSIGHT_POOL].sort((a, b) => score(b) - score(a));
}

export type SampleCluster = { name: string; traces: Record<string, number> };

/** 按权重把 total 分成整数份，份数之和正好等于 total（最大余数法）。 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((value) => (total * value) / sum);
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((acc, value) => acc + value, 0);
  const order = raw.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (let cursor = 0; left > 0; cursor = (cursor + 1) % order.length, left -= 1) parts[order[cursor].index] += 1;
  return parts;
}

/**
 * 把本轮 trace 按洞见的类别分组，每个参与方的 trace 按相关程度分到各类。
 * 和关系分析一样，每条 trace 只归入一类，所以各类之和等于上传总数。
 */
export function sampleClusters(entries: readonly PoolEntry[], traces: Record<string, number>): SampleCluster[] {
  const categories = [...new Set(entries.map((entry) => entry.category))];
  const weight = (category: string, datasetId: string) => {
    const members = entries.filter((entry) => entry.category === category);
    const related = members.some((entry) => entry.affinity.length === 0 || entry.affinity.includes(datasetId));
    return (related ? 2 : 0.5) * members.length;
  };
  const shares = Object.fromEntries(Object.entries(traces).map(([id, count]) => [
    id,
    apportion(count, categories.map((category) => weight(category, id))),
  ]));
  return categories.map((name, index) => ({
    name,
    traces: Object.fromEntries(Object.keys(traces).map((id) => [id, shares[id][index]])),
  }));
}

export function sampleTokens(taskId: string, round: number, problems: number, traces: number): number {
  const participant = problems * 13000 * (0.94 + 0.12 * unit(`${taskId}|tokens|${round}`));
  const server = traces * 150 * 2 + 16000;
  return Math.round(participant + server);
}

/** 某个参与方某一轮上传的 trace 示例（只取前几条展示）。 */
export function sampleTraceTexts(datasetId: string, round: number, limit: number): { key: string; text: string }[] {
  const related = INSIGHT_POOL.filter((entry) => entry.affinity.length === 0 || entry.affinity.includes(datasetId));
  const source = related.length ? related : INSIGHT_POOL;
  const offset = (round - 1) % source.length;
  const rotated = [...source.slice(offset), ...source.slice(0, offset)];
  return rotated.slice(0, limit).map((entry) => ({ key: entry.key, text: entry.trace }));
}
