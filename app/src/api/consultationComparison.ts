import { request } from "./client";
import type { components } from "./schema";

type Schemas = components["schemas"];
export type ConsultationComparison = Schemas["ComparisonOut"];
export type ConsultationComparisonArm = Schemas["ComparisonArm"];
const base = "/v1/consultation/comparisons";
const pathOf = (id: string) => base + "/" + encodeURIComponent(id);

export const consultationComparisons = {
  cases: (signal: AbortSignal) => request<Schemas["ComparisonCase"][]>("GET", "/v1/consultation/comparison-cases", undefined, signal),
  active: (signal: AbortSignal) => request<ConsultationComparison | null>("GET", base + "/active", undefined, signal),
  get: (id: string, signal: AbortSignal) => request<ConsultationComparison>("GET", pathOf(id), undefined, signal),
  start: (input: Schemas["ComparisonIn"]) => request<ConsultationComparison>("POST", base, input),
  control: (id: string, action: "resume" | "cancel") => request<ConsultationComparison>("POST", pathOf(id) + "/" + action),
};
