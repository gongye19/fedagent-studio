import { request } from "./client";
import type { components } from "./schema";
export type AgentEndpoint = components["schemas"]["AgentOut"];
export type AgentInput = components["schemas"]["AgentIn"];
export const agentsApi = {
  list: () => request<AgentEndpoint[]>("GET", "/v1/agents"),
  save: (body: AgentInput, id?: string) =>
    request<AgentEndpoint>(id ? "PUT" : "POST", `/v1/agents${id ? `/${encodeURIComponent(id)}` : ""}`, body),
  remove: (id: string) => request<void>("DELETE", `/v1/agents/${encodeURIComponent(id)}`),
  check: (id: string) => request<AgentEndpoint>("POST", `/v1/agents/${encodeURIComponent(id)}/check`),
  verify: (id: string, body: components["schemas"]["AgentVerificationIn"]) =>
    request<components["schemas"]["TaskCheckOut"]>("POST", `/v1/agents/${encodeURIComponent(id)}/verifications`, body),
};
