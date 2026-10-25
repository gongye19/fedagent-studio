import { useEffect, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { hrefOf, type Route } from "../state/route";
import { Icon } from "./icons";
export { Notice, Toast, Confirm } from "./shared/feedback";
export { CodeBlock } from "./shared/CodeBlock";
export { TabLinks } from "./shared/TabLinks";

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
  title, back, status, meta, actions, className,
}: {
  title: string;
  /** 下级页面必须提供明确的上级入口，不依赖浏览器历史。 */
  back?: { label: string; route: Route };
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
        {back ? (
          <nav className="page-back" aria-label="返回上级">
            <a className="button button--secondary button--compact" href={hrefOf(back.route)}>
              <Icon name="back" />返回{back.label}
            </a>
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
        <button type="button" className={`button button--secondary${size}`} disabled={saving} onClick={onCancel}>{cancelLabel}</button>
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

/** 找不到对象时仍然是一个完整的页面：有标题、有返回的位置，正文说明原因。 */
export function NotFound({ kind, back, backLabel }: { kind: string; back: Route; backLabel: string }) {
  return (
    <>
      <PageHead title={`没有找到这个${kind}`} back={{ label: backLabel, route: back }} />
      <EmptyState title="可能已被删除" />
    </>
  );
}
