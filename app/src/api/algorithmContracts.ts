import { request } from "./client";

export type AlgorithmContract = {
  resourcesNote: string;
  manifest: { steps: { id: string; per: "item" | "site" }[] };
  plans: Record<string, string[]>;
  dataContracts: Record<string, { schemaVersion: string; format: string; rules: string; template: unknown[] }>;
  agentProtocol: null | {
    protocol: string;
    endpoints: Record<string, string>;
    limits: { requestBytes: number; responseBytes: number; messageBytes: number };
    capabilitiesSchema: Record<string, unknown>;
    requestSchema: Record<string, unknown>;
    responseSchema: Record<string, unknown>;
  };
  outputContract: Record<string, Record<string, unknown>>;
};

export const algorithmContract = (id: string) =>
  request<AlgorithmContract>("GET", `/v1/algorithms/${encodeURIComponent(id)}/contract`);
