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
  get: (id: string, signal?: AbortSignal) => request<PackageEvaluation>("GET", pathOf(id) + "?includeCases=false", undefined, signal),
  cases: (id: string, filters: { site: string; change: string; offset: number; limit: number }, signal: AbortSignal) => {
    const query = new URLSearchParams({ change: filters.change, offset: String(filters.offset), limit: String(filters.limit) });
    if (filters.site !== "all") query.set("site", filters.site);
    return request<Schemas["PackageEvaluationCasePage"]>("GET", pathOf(id) + "/cases?" + query, undefined, signal);
  },
  start: (input: PackageEvaluationInput) => request<PackageEvaluation>("POST", base, input),
  control: (id: string, action: "resume" | "cancel") => request<PackageEvaluation>("POST", pathOf(id) + "/" + action),
};
