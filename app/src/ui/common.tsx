import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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

const PRODUCT = "Federation Studio";

/** 页面标题：同时写进浏览器标签页的标题，多开标签页和读屏时都能分清是哪一页。 */
export function PageHead({
  title, crumbs, status, meta, actions,
}: {
  title: string;
  crumbs?: readonly { label: string; route: Route }[];
  status?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · ${PRODUCT}`;
  }, [title]);
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

/** 全站唯一的折叠样式（高级配置）：左侧箭头朝右，展开后朝下；标题右边可以跟一句说明。 */
export function Collapsible({
  title, sub, children, className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`module${className ? ` ${className}` : ""}`}>
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

/**
 * 一行元信息，各段之间用"·"分隔。每段不折行；折行时分隔点落在被裁掉的行首位置，
 * 所以"·"既不会挂在行尾，也不会出现在行首。
 */
export function Meta({ parts }: { parts: readonly ReactNode[] }) {
  const shown = parts.filter((part) => part !== null && part !== undefined && part !== false && part !== "");
  return (
    <span className="meta">
      <span className="meta-row">
        {shown.map((part, index) => <span key={index} className="meta-part">{part}</span>)}
      </span>
    </span>
  );
}

/**
 * 代码块。复制按钮在代码上方，不压住代码；展示的是节选时，用 copyText 复制完整内容。
 * 还没上线的命令（规划中的 API、未发布的客户端）传 copyable={false}，只给人看，不让复制。
 */
export function CodeBlock({
  code, copyText, copyLabel = "复制", wrap = false, copyable = true,
}: {
  code: string;
  copyText?: string;
  copyLabel?: string;
  wrap?: boolean;
  copyable?: boolean;
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
      {copyable ? (
        <div className="code-bar">
          <button type="button" className="button button--secondary button--compact" onClick={copy}>
            {copied ? <><Icon name="check" />已复制</> : <><Icon name="copy" />{copyLabel}</>}
          </button>
        </div>
      ) : null}
      <pre className={`code-block${wrap ? " code-block--wrap" : ""}`} translate="no">{code}</pre>
    </div>
  );
}

/** 页面顶部的一行提示：已恢复草稿、已保存、已发布等。可以带一个操作链接和"知道了"。 */
export function Notice({ children, action, onDismiss }: { children: ReactNode; action?: ReactNode; onDismiss?: () => void }) {
  return (
    <div className="notice" role="status">
      <span>{children}</span>
      {action}
      {onDismiss ? <button type="button" className="link-button notice-dismiss" onClick={onDismiss}>知道了</button> : null}
    </div>
  );
}

/**
 * 页面内的确认条：取消任务、删除、重置、撤下、正式运行这类操作都用它，不用浏览器弹窗。
 * 出现时焦点落在确认按钮上，Esc 或"取消"收起。danger 用红色确认按钮，primary 用黑色。
 */
export function Confirm({
  title, children, confirmLabel, cancelLabel = "取消", tone = "danger", onConfirm, onCancel, className,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const id = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
    }
  }
  return (
    <div
      className={`confirm${className ? ` ${className}` : ""}`}
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={children ? `${id}-text` : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="confirm-copy">
        <strong id={`${id}-title`}>{title}</strong>
        {children ? <div id={`${id}-text`} className="confirm-text">{children}</div> : null}
      </div>
      <div className="confirm-actions">
        <button type="button" className="button button--secondary" onClick={onCancel}>{cancelLabel}</button>
        <button ref={confirmRef} type="button" className={`button ${tone === "danger" ? "button--danger-solid" : "button--primary"}`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  );
}

/**
 * 表单底部的操作：保存按钮不可用时，在左侧写清还差什么，而不是只把按钮变灰。
 * 缺项说明和保存按钮关联（aria-describedby），读屏用户按到按钮时也能听到。
 */
export function FormActions({
  missing, onCancel, onSave, saveLabel = "保存", compact = false, cancelLabel = "取消",
}: {
  missing: readonly string[];
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
  compact?: boolean;
  cancelLabel?: string;
}) {
  const id = useId();
  const size = compact ? " button--compact" : "";
  return (
    <div className="form-actions">
      {/* 始终保留这个区域，读屏软件才能在缺项变化时播报 */}
      <span className="form-status" id={id} aria-live="polite">{missing.length ? `还需填写：${missing.join("、")}` : ""}</span>
      <div className="form-buttons">
        <button type="button" className={`button button--secondary${size}`} onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className={`button button--primary${size}`} disabled={missing.length > 0} aria-describedby={missing.length ? id : undefined} onClick={onSave}>{saveLabel}</button>
      </div>
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

/** 面板里的空状态：一句话 + 下一步能做什么。 */
export function PanelEmpty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel-empty">
      <p>{children}</p>
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

export function Stat({ label, value, sub, tone, href }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "up" | "down"; href?: string }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ""}`}>
      <dt>{label}</dt>
      <dd>
        <strong>{href ? <a className="stat-link" href={href}>{value}</a> : value}</strong>
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

/** 找不到对象时仍然是一个完整的页面：有标题、有返回的位置，正文说明原因。 */
export function NotFound({ kind, back, backLabel }: { kind: string; back: Route; backLabel: string }) {
  return (
    <>
      <PageHead title={`没有找到这个${kind}`} crumbs={[{ label: backLabel, route: back }]} />
      <EmptyState title="可能已被删除，或者演示数据已重置" action={<a className="button button--secondary" href={hrefOf(back)}>返回{backLabel}</a>} />
    </>
  );
}
