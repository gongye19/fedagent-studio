import type { components } from "./schema";
import { request } from "./client";

export type CaseResult = components["schemas"]["CaseOut"];
export type CaseOutcome = CaseResult["outcome"];
export function casePage(taskId: string, round: number, outcome: string, offset: number) {
  const query = new URLSearchParams({ offset: String(offset) });
  if (round) query.set("round", String(round));
  if (outcome) query.set("outcome", outcome);
  return request<components["schemas"]["CasePageOut"]>("GET", `/v1/tasks/${encodeURIComponent(taskId)}/cases?${query}`);
}
