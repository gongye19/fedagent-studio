import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { hrefOf, type Route } from "../state/route";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/** 状态胶囊只用于需要注意的状态（运行中、已暂停、等待连接、待配置……），正常状态用普通文字。 */
export function StatusPill({ tone = "neutral", children, live = false }: { tone?: Tone; children: ReactNode; live?: boolean }) {
  return (
    <span className={`status status--${tone}`}>
      {live ? <span className="status-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** sample 只用于"示例数据"，其他含义不要借用这个颜色。 */
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "sample" | "accent" }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
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

/** 页面里的一个区块：标题 + 内容，用间距分隔，不套边框。 */
export function Section({
  title, meta, actions, children, id, className,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  const headingId = id && title ? `${id}-title` : undefined;
  return (
    <section className={`section${className ? ` ${className}` : ""}`} id={id} aria-labelledby={headingId}>
      {title || actions ? (
        <header className="section-head">
          <div className="section-heading">
            {title ? <h2 id={headingId}>{title}</h2> : null}
            {meta ? <p className="section-meta">{meta}</p> : null}
          </div>
          {actions ? <div className="section-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children ? <div className="empty-body">{children}</div> : null}
      {action}
    </div>
  );
}

export function ProgressBar({ value, label, tone = "info" }: { value: number; label: string; tone?: "info" | "warning" | "neutral" }) {
  const ratio = Math.min(1, Math.max(0, value));
  return (
    <div className={`progress progress--${tone}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
      <span style={{ transform: `scaleX(${ratio})` }} />
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "up" | "down" }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ""}`}>
      <dt>{label}</dt>
      <dd>
        <strong>{value}</strong>
        {sub ? <span className="stat-sub">{sub}</span> : null}
      </dd>
    </div>
  );
}

export function Facts({ items, className }: { items: readonly (readonly [string, ReactNode])[]; className?: string }) {
  return (
    <dl className={`facts${className ? ` ${className}` : ""}`}>
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
  tabs, active, routeOf, label, end,
}: {
  tabs: readonly { id: T; label: ReactNode }[];
  active: T;
  routeOf: (id: T) => Route;
  label: string;
  /** 标签栏右侧的附加信息，例如"示例数据"。 */
  end?: ReactNode;
}) {
  return (
    <div className="tab-bar">
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
      {end ? <div className="tab-bar-end">{end}</div> : null}
    </div>
  );
}

/** 单选分段控件：方向键在选项间移动，只有当前选项在 Tab 顺序里。 */
export function Segmented<T extends string>({
  options, value, onChange, label,
}: {
  options: readonly { id: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, options.findIndex((option) => option.id === value));

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.id}
          ref={(element) => { refs.current[index] = element; }}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          tabIndex={index === current ? 0 : -1}
          className={`segment${option.id === value ? " segment--active" : ""}`}
          onClick={() => onChange(option.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
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
      <p>可能已被删除，或者演示数据已重置。</p>
    </EmptyState>
  );
}
