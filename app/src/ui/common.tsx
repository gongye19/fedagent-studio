import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { hrefOf, type Route } from "../state/route";
import { ApiError } from "../api/client";
import { Icon } from "./icons";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/** 列表搜索：图标在控件内，名称和键盘行为仍由原生输入框提供。 */
export function SearchInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <div className="search-field"><Icon name="search" /><input {...props} type="search" autoComplete="off" /></div>;
}

/**
 * 全站唯一的标签样式（胶囊）。颜色只按含义选：
 * warning 黄色 = 需要处理（等待连接、待配置、已暂停）；
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

const PRODUCT = "FedAgent Studio";

/** 页面标题：同时写进浏览器标签页的标题，多开标签页和读屏时都能分清是哪一页。 */
export function PageHead({
  title, crumbs, status, meta, actions, className,
}: {
  title: string;
  crumbs?: readonly { label: string; route: Route }[];
  status?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** 例如首页用 page-head--center 居中。 */
  className?: string;
}) {
  useEffect(() => {
    document.title = `${title} · ${PRODUCT}`;
  }, [title]);
  return (
    <header className={`page-head${className ? ` ${className}` : ""}`}>
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
  const [copyError, setCopyError] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    const text = copyText ?? code;
    setCopyError(false);
    try {
      if (window.isSecureContext && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        // Tailscale 的 HTTP 地址没有 Clipboard API，仍允许通过用户点击复制。
        const active = document.activeElement as HTMLElement | null;
        const input = document.createElement("textarea");
        input.value = text;
        input.style.cssText = "position:fixed;left:-9999px;top:0";
        input.setAttribute("aria-hidden", "true");
        document.body.append(input);
        try {
          input.select();
          if (!document.execCommand("copy")) throw new Error("copy failed");
        } finally {
          input.remove();
          active?.focus({ preventScroll: true });
        }
      }
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError(true);
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
      {copyError ? <p className="field-error" role="status">浏览器未允许复制，请选中代码手动复制。</p> : null}
    </div>
  );
}

/** 页面顶部的一行提示：已恢复草稿、已保存、已发布等。可以带一个操作链接和"知道了"。 */
export function Notice({
  children, action, onDismiss, tone = "info",
}: {
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  /** warning：需要处理的情况（任务暂停的原因、操作失败）。 */
  tone?: "info" | "warning";
}) {
  return (
    <div className={`notice${tone === "warning" ? " notice--warning" : ""}`} role={tone === "warning" ? "alert" : "status"}>
      <span>{children}</span>
      {action}
      {onDismiss ? <button type="button" className="link-button notice-dismiss" onClick={onDismiss}>知道了</button> : null}
    </div>
  );
}

/** 成功反馈不占页面布局、不抢焦点；停留／键盘聚焦时暂停自动关闭。 */
export function Toast({ children, action, onDismiss }: { children: ReactNode; action?: ReactNode; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const dismiss = useRef(onDismiss);
  const remaining = useRef(action ? 10000 : 6000);
  useEffect(() => { dismiss.current = onDismiss; });
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismiss.current(), remaining.current);
    return () => { window.clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [paused]);
  return createPortal(
    <div className="toast" onPointerEnter={() => setPaused(true)} onPointerLeave={(event) => setPaused(event.currentTarget.contains(document.activeElement))}
      onFocus={() => setPaused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(event.currentTarget.matches(":hover")); }}>
      <span className="toast-mark"><Icon name="check" /></span>
      <div className="toast-copy"><span role="status" aria-live="polite" aria-atomic="true">{children}</span>{action}</div>
      <button type="button" className="toast-close" aria-label="关闭通知" onClick={onDismiss}><Icon name="x" /></button>
    </div>, document.body,
  );
}

/** 原生模态确认：背景不可操作，默认焦点在取消；关闭后回到触发处，不滚动页面。 */
export function Confirm({
  title, children, confirmLabel, cancelLabel = "取消", tone = "danger", onConfirm, onCancel, error,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  error?: string | null;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submitting = useRef(false);
  const cancel = useRef(onCancel);
  useEffect(() => { cancel.current = onCancel; });
  useEffect(() => {
    if (busy) dialogRef.current?.focus({ preventScroll: true });
    else if (dialogRef.current?.open) cancelRef.current?.focus({ preventScroll: true });
  }, [busy]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 删除行后触发按钮不再存在，优先移到相邻行的操作；换页时由路由管理主内容焦点。
    const row = trigger?.closest("tr");
    const nearby = row?.nextElementSibling?.querySelector<HTMLElement>("button, a[href]") ?? row?.previousElementSibling?.querySelector<HTMLElement>("button, a[href]");
    const overflow = document.body.style.overflow;
    const requestCancel = (event: Event) => { event.preventDefault(); if (!submitting.current) cancel.current(); };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!submitting.current) cancel.current();
    };
    document.addEventListener("keydown", escape, true);
    dialog.addEventListener("cancel", requestCancel);
    dialog.showModal();
    cancelRef.current?.focus({ preventScroll: true });
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", escape, true);
      dialog.removeEventListener("cancel", requestCancel);
      dialog.close();
      document.body.style.overflow = overflow;
      queueMicrotask(() => {
        const target = trigger?.isConnected && !trigger.matches(":disabled") ? trigger : nearby?.isConnected ? nearby : document.getElementById("main");
        if (document.activeElement === document.body || document.activeElement === trigger || dialog.contains(document.activeElement)) target?.focus({ preventScroll: true });
      });
    };
  }, []);
  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await onConfirm();
    } catch (problem) {
      setFailure(problem instanceof ApiError ? problem.message : "操作失败，稍后再试");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const problem = failure ?? error;
  return createPortal(
    <dialog ref={dialogRef} className="confirm-dialog" role="alertdialog" tabIndex={-1} aria-modal="true"
      aria-labelledby={`${id}-title`} aria-describedby={children ? `${id}-text` : undefined} aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const first = buttons[0];
        const last = buttons.at(-1);
        if (!first) { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      >
      <div className="confirm-panel">
        <div className="confirm-heading"><h2 id={`${id}-title`}>{title}</h2>
          <button type="button" className="dialog-close" aria-label="关闭确认" disabled={busy} onClick={onCancel}><Icon name="x" /></button>
        </div>
        {children ? <div id={`${id}-text`} className="confirm-description">{children}</div> : null}
        {problem ? <p className="confirm-error" role="alert">{problem}</p> : null}
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="button button--secondary" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={`button ${tone === "danger" ? "button--danger-solid" : "button--primary"}`} disabled={busy} onClick={() => void submit()}>{busy ? "正在处理…" : confirmLabel}</button>
        </div>
      </div>
    </dialog>, document.body,
  );
}

/**
 * 表单底部的操作：保存按钮不可用时，在左侧写清还差什么，而不是只把按钮变灰。
 * 缺项说明和保存按钮关联（aria-describedby），读屏用户按到按钮时也能听到。
 */
export function FormActions({
  missing, onCancel, onSave, saveLabel = "保存", compact = false, cancelLabel = "取消", saving = false, error,
}: {
  missing: readonly string[];
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
  compact?: boolean;
  cancelLabel?: string;
  /** 正在提交：保存按钮不可用，状态里写"正在保存…"。 */
  saving?: boolean;
  /** 提交失败的原因（后端写明的），写在状态里。 */
  error?: string | null;
}) {
  const id = useId();
  const size = compact ? " button--compact" : "";
  const status = saving ? "正在保存…" : error ? error : missing.length ? `还需填写：${missing.join("、")}` : "";
  return (
    <div className="form-actions">
      {/* 始终保留这个区域，读屏软件才能在缺项变化时播报 */}
      <span className={`form-status${error && !saving ? " form-status--error" : ""}`} id={id} aria-live="polite">{status}</span>
      <div className="form-buttons">
        <button type="button" className={`button button--secondary${size}`} onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className={`button button--primary${size}`} disabled={missing.length > 0 || saving} aria-describedby={status ? id : undefined} onClick={onSave}>{saveLabel}</button>
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
      <EmptyState title="可能已被删除" action={<a className="button button--secondary" href={hrefOf(back)}>返回{backLabel}</a>} />
    </>
  );
}
