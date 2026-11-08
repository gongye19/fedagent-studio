import { request } from "./client";
import type { components } from "./schema";

type Schemas = components["schemas"];
export type PackageEvaluationSummary = Schemas["PackageEvaluationSummary"];
export type PackageEvaluation = Schemas["PackageEvaluationOut"];
export type PackageEvaluationInput = Schemas["PackageEvaluationIn"];
const base = "/v1/evaluations";
const pathOf = (id: string) => base + "/" + encodeURIComponent(id);

export const packageEvaluations = {
  list: (signal: AbortSignal) => request<PackageEvaluationSummary[]>("GET", base, undefined, signal),
  get: (id: string, signal?: AbortSignal) => request<PackageEvaluation>("GET", pathOf(id), undefined, signal),
  start: (input: PackageEvaluationInput) => request<PackageEvaluation>("POST", base, input),
  control: (id: string, action: "resume" | "cancel") => request<PackageEvaluation>("POST", pathOf(id) + "/" + action),
};
