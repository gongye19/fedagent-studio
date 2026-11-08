import type { ReactNode } from "react";

export function ConsultationMessage({ role, content, speaker, note }: {
  role: "user" | "assistant";
  content: string;
  speaker?: string;
  note?: ReactNode;
}) {
  return <article className={`consultation-message consultation-message--${role}`}>
    <strong className={speaker ? "consultation-speaker" : "visually-hidden"}>{speaker ?? "你"}</strong>
    <p>{content}</p>
    {note && <small>{note}</small>}
  </article>;
}
