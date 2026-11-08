import type { PackageEvaluationSummary } from "../../api/evaluations";

export const evaluationListKey = ["package-evaluations"];
export const evaluationsRoute = { page: "evaluations" } as const;
export const USAGE = {
  backtest: "原病例回测",
  heldout: "未参与生成",
  mixed: "含原病例回测",
} as const;

export function activeEvaluation(status?: PackageEvaluationSummary["status"]) {
  return status === "queued" || status === "running";
}
