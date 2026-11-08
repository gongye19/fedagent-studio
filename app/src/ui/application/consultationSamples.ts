import type { ChatMessage, ConsultationSample } from "../../api/consultation";

export function sampleProgress(messages: readonly ChatMessage[], samples: readonly ConsultationSample[]) {
  const userTurns = messages.filter(({ role }) => role === "user");
  if (!userTurns.length) return undefined;
  const sample = samples.find(({ turns }) => userTurns.every(({ content }, index) => content === turns[index]?.text));
  if (!sample) return undefined;
  return { sent: userTurns.length, total: sample.turns.length, next: sample.turns.at(userTurns.length) };
}
