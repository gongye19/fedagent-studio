import type { ReactNode } from "react";
import { hrefOf, type Route } from "../state/route";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export function StatusPill({ tone = "neutral", children, live = false }: { tone?: Tone; children: ReactNode; live?: boolean }) {
  return (
    <span className={`status status--${tone}`}>
      {live ? <span className="status-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "sample" | "accent"; title?: string }) {
  return <span className={`badge badge--${tone}`} title={title}>{children}</span>;
}

export function PageHead({
  title, crumbs, status, meta, actions,
}: {
  title: string;
  crumbs?: readonly { label: string; route: Route }[];
  status?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-title">
        {crumbs?.length ? (
          <nav className="crumbs" aria-label="位置">
            {crumbs.map((crumb) => <a key={crumb.label} href={hrefOf(crumb.route)}>{crumb.label}</a>)}
          </nav>
        ) : null}
        <div className="page-title-row">
          <h1>{title}</h1>
          {status}
        </div>
        {meta ? <p className="page-meta">{meta}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title, extra, children, className, id, flush = false,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  flush?: boolean;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`panel${className ? ` ${className}` : ""}`} id={id} aria-labelledby={title ? headingId : undefined}>
      {title ? (
        <header className="panel-head">
          <h2 id={headingId}>{title}</h2>
          {extra ? <div className="panel-extra">{extra}</div> : null}
        </header>
      ) : null}
      <div className={flush ? "panel-flush" : "panel-body"}>{children}</div>
    </section>
  );
}

export function SampleNote({ children }: { children?: ReactNode }) {
  return (
    <p className="sample-note" role="note">
      <Badge tone="sample">示例数据</Badge>
      <span>{children ?? "前端原型模拟运行生成，不代表真实运行结果。"}</span>
    </p>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="note">{children}</p>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function ProgressBar({ value, label, tone = "info" }: { value: number; label: string; tone?: "info" | "success" | "warning" | "neutral" }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={`progress progress--${tone}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "up" | "down" }) {
  return (
    <div className={`kpi${tone ? ` kpi--${tone}` : ""}`}>
      <dt>{label}</dt>
      <dd>
        <strong>{value}</strong>
        {sub ? <small>{sub}</small> : null}
      </dd>
    </div>
  );
}

export function Facts({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 链接式标签页：每个标签是一个地址，刷新后停在同一页。 */
export function TabLinks<T extends string>({
  tabs, active, routeOf, label,
}: {
  tabs: readonly { id: T; label: ReactNode }[];
  active: T;
  routeOf: (id: T) => Route;
  label: string;
}) {
  return (
    <nav className="tabs" aria-label={label}>
      {tabs.map((tab) => (
        <a
          key={tab.id}
          className={`tab${tab.id === active ? " tab--active" : ""}`}
          href={hrefOf(routeOf(tab.id))}
          aria-current={tab.id === active ? "page" : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

export function Segmented<T extends string>({
  options, value, onChange, label,
}: {
  options: readonly { id: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          className={`segment${option.id === value ? " segment--active" : ""}`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
          {option.count !== undefined ? <span className="segment-count">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function NotFound({ kind, back }: { kind: string; back: Route }) {
  return (
    <EmptyState title={`没有找到这个${kind}`} action={<a className="button button--secondary" href={hrefOf(back)}>返回</a>}>
      可能已被删除，或者演示数据已重置。
    </EmptyState>
  );
}
