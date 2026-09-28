import { Fragment, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { hrefOf, type Route } from "../state/route";
import { Icon } from "./icons";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/**
 * 全站唯一的标签样式（胶囊）。颜色只按含义选：
 * warning 黄色 = 需要处理或示例数据（等待连接、待配置、已暂停、示例数据）；
 * info 蓝色 = 进行中或新增；neutral 灰色 = 普通属性（参与方本地、规划中、无答案）。
 */
export function Tag({ tone = "neutral", children, live = false }: { tone?: Tone; children: ReactNode; live?: boolean }) {
  return (
    <span className={`tag tag--${tone}`}>
      {live ? <span className="tag-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
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

/**
 * 全站唯一的折叠样式：左侧箭头朝右，展开后朝下。
 * card 为 true 时是带边框的模块（流程说明、高级设置），为 false 时是正文里的一行文字开关。
 */
export function Collapsible({
  title, sub, children, card = true, className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  card?: boolean;
  className?: string;
}) {
  return (
    <details className={`${card ? "module" : "disclosure"}${className ? ` ${className}` : ""}`}>
      <summary>
        <Icon name="chevron" />
        <span className="module-title">
          <strong>{title}</strong>
          {sub ? <small>{sub}</small> : null}
        </span>
      </summary>
      <div className="module-body">{children}</div>
    </details>
  );
}

/** 一行元信息：各段之间用"·"分隔，只在段与段之间换行，不会把"完成于 9/26"拆成两行。 */
export function Meta({ parts }: { parts: readonly ReactNode[] }) {
  const shown = parts.filter((part) => part !== null && part !== undefined && part !== false && part !== "");
  return (
    <>
      {shown.map((part, index) => (
        <Fragment key={index}>
          {index ? " · " : null}
          <span className="meta-part">{part}</span>
        </Fragment>
      ))}
    </>
  );
}

/** 代码块：右上角可以一键复制；展示的是节选时，用 copyText 复制完整内容。 */
export function CodeBlock({
  code, copyText, copyLabel = "复制", wrap = false,
}: {
  code: string;
  copyText?: string;
  copyLabel?: string;
  wrap?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(copyText ?? code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 浏览器不允许写剪贴板时不做处理，用户仍可手动选中复制。
    }
  }
  return (
    <div className="code">
      <pre className={`code-block${wrap ? " code-block--wrap" : ""}`} translate="no">{code}</pre>
      <button type="button" className="button button--secondary button--compact code-copy" onClick={copy}>
        {copied ? <><Icon name="check" />已复制</> : <><Icon name="copy" />{copyLabel}</>}
      </button>
    </div>
  );
}

/** 页面顶部的一行提示：已恢复草稿、已保存等。 */
export function Notice({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="notice" role="status">
      <span>{children}</span>
      {action}
    </div>
  );
}

/**
 * 表单底部的操作：保存按钮不可用时，在左侧写清还差什么，而不是只把按钮变灰。
 */
export function FormActions({
  missing, onCancel, onSave, saveLabel = "保存", compact = false,
}: {
  missing: readonly string[];
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
  compact?: boolean;
}) {
  const size = compact ? " button--compact" : "";
  return (
    <div className="form-actions">
      {/* 始终保留这个区域，读屏软件才能在缺项变化时播报 */}
      <span className="form-status" aria-live="polite">{missing.length ? `还需填写：${missing.join("、")}` : ""}</span>
      <button type="button" className={`button button--secondary${size}`} onClick={onCancel}>取消</button>
      <button type="button" className={`button button--primary${size}`} disabled={missing.length > 0} onClick={onSave}>{saveLabel}</button>
    </div>
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
  tabs, active, routeOf, label,
}: {
  tabs: readonly { id: T; label: ReactNode }[];
  active: T;
  routeOf: (id: T) => Route;
  label: string;
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

export function NotFound({ kind, back, backLabel }: { kind: string; back: Route; backLabel: string }) {
  return (
    <EmptyState title={`没有找到这个${kind}`} action={<a className="button button--secondary" href={hrefOf(back)}>返回{backLabel}</a>}>
      <p>可能已被删除，或者演示数据已重置。</p>
    </EmptyState>
  );
}
