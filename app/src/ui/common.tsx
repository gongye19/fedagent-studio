import type { ReactNode } from "react";

export type Tone = "complete" | "running" | "failed" | "ready";

export function StepFrame({
  title, status, statusTone, children,
}: {
  title: string;
  status: string;
  statusTone?: Tone;
  children: ReactNode;
}) {
  return (
    <section className="step-content" aria-labelledby="step-title">
      <header className="step-header">
        <h2 id="step-title">{title}</h2>
        <span className={`status${statusTone ? ` status--${statusTone}` : ""}`}>{status}</span>
      </header>
      <div className="step-body">{children}</div>
    </section>
  );
}

export function StepActions({
  onBack, onNext, onReset, nextLabel, nextDisabled = false,
}: {
  onBack?: () => void;
  onNext?: () => void;
  onReset?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <footer className="step-actions">
      <div>{onBack ? <button type="button" className="button button--secondary" onClick={onBack}>上一步</button> : null}</div>
      <div className="step-actions-end">
        {onReset ? <button type="button" className="button button--secondary" onClick={onReset}>新建运行</button> : null}
        {onNext ? <button type="button" className="button button--primary" disabled={nextDisabled} onClick={onNext}>{nextLabel ?? "下一步"}</button> : null}
      </div>
    </footer>
  );
}

export function StageMessage({ text, running = false, tone }: { text: string; running?: boolean; tone?: "failed" }) {
  return (
    <div className={`stage-message${running ? " stage-message--running" : ""}${tone ? ` stage-message--${tone}` : ""}`} aria-live="polite">
      {running ? <span aria-hidden="true" /> : null}
      <p>{text}</p>
    </div>
  );
}

export function Facts({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="stage-facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LogList({ logs, label }: { logs: readonly string[]; label: string }) {
  if (!logs.length) return null;
  return (
    <ol className="log-list" aria-label={label}>
      {logs.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
    </ol>
  );
}
