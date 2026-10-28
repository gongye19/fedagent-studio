import type { components } from "./schema";
import { request } from "./client";

export type ProcessEvent = components["schemas"]["ProcessEventOut"];
export async function processPage(taskId: string, after: number, round: number, site: string) {
  const query = new URLSearchParams({ after: String(after), round: String(round) });
  if (site) query.set("site", site);
  return request<components["schemas"]["ProcessPageOut"]>("GET", `/v1/tasks/${encodeURIComponent(taskId)}/process?${query}`);
}
