import type { components } from "./schema";
import { request } from "./client";

type Schemas = components["schemas"];
export type ChatMessage = Schemas["ChatMessage"];
export type ChatReply = Schemas["ConsultationOut"];

export function consult(packageId: string | null, model: string, messages: ChatMessage[], signal: AbortSignal) {
  return request<ChatReply>("POST", "/v1/consultation/chat", { packageId, model, messages }, signal);
}

export type EvaluationSource = Schemas["EvaluationSource"];
export type EvaluationCase = Schemas["EvaluationCase"];
export type EvaluationScore = Schemas["EvaluationScore"];
export type Evaluation = Schemas["EvaluationOut"];
const pathOf = (taskId: string) => `/v1/tasks/${encodeURIComponent(taskId)}/experience-evaluation`;
export const experienceEvaluation = {
  get: (taskId: string) => request<Evaluation | null>("GET", pathOf(taskId)),
  start: (taskId: string, body: { model: string; sources: EvaluationSource[] }) => request<Evaluation>("POST", pathOf(taskId), body),
  control: (taskId: string, action: "resume" | "cancel") => request<Evaluation>("POST", `${pathOf(taskId)}/${action}`),
};
