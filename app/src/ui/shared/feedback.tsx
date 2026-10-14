import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../../api/client";
import { Icon } from "../icons";

/** 页面级状态提示；任务字段错误留在对应字段，成功反馈使用 Toast。 */
export function Notice({
  children,
  action,
  onDismiss,
  tone = "info",
}: {
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  /** warning：需要处理的情况（任务暂停的原因、操作失败）。 */
  tone?: "info" | "warning";
}) {
  return (
    <div
      className={`notice${tone === "warning" ? " notice--warning" : ""}`}
      role={tone === "warning" ? "alert" : "status"}
    >
      <span>{children}</span>
      {action}
      {onDismiss ? (
        <button type="button" className="link-button notice-dismiss" onClick={onDismiss}>
          知道了
        </button>
      ) : null}
    </div>
  );
}

/** 成功反馈不占页面布局、不抢焦点；停留／键盘聚焦时暂停自动关闭。 */
export function Toast({
  children,
  action,
  onDismiss,
}: {
  children: ReactNode;
  action?: ReactNode;
  onDismiss: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const dismiss = useRef(onDismiss);
  const remaining = useRef(action ? 10000 : 6000);
  useEffect(() => {
    dismiss.current = onDismiss;
  });
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismiss.current(), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [paused]);
  return createPortal(
    <div
      className="toast"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={(event) => setPaused(event.currentTarget.contains(document.activeElement))}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(event.currentTarget.matches(":hover"));
      }}
    >
      <span className="toast-mark">
        <Icon name="check" />
      </span>
      <div className="toast-copy">
        <span role="status" aria-live="polite" aria-atomic="true">
          {children}
        </span>
        {action}
      </div>
      <button type="button" className="toast-close" aria-label="关闭通知" onClick={onDismiss}>
        <Icon name="x" />
      </button>
    </div>,
    document.body,
  );
}

/** 原生模态确认：背景不可操作，默认焦点在取消；关闭后回到触发处，不滚动页面。 */
export function Confirm({
  title,
  children,
  confirmLabel,
  cancelLabel = "取消",
  tone = "danger",
  onConfirm,
  onCancel,
  error,
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
  useEffect(() => {
    cancel.current = onCancel;
  });
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
    const nearby =
      row?.nextElementSibling?.querySelector<HTMLElement>("button, a[href]") ??
      row?.previousElementSibling?.querySelector<HTMLElement>("button, a[href]");
    const overflow = document.body.style.overflow;
    const requestCancel = (event: Event) => {
      event.preventDefault();
      if (!submitting.current) cancel.current();
    };
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
        const target =
          trigger?.isConnected && !trigger.matches(":disabled")
            ? trigger
            : nearby?.isConnected
              ? nearby
              : document.getElementById("main");
        if (
          document.activeElement === document.body ||
          document.activeElement === trigger ||
          dialog.contains(document.activeElement)
        )
          target?.focus({ preventScroll: true });
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
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      role="alertdialog"
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={children ? `${id}-text` : undefined}
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const first = buttons[0];
        const last = buttons.at(-1);
        if (!first) {
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
        } else if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === event.currentTarget)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div className="confirm-panel">
        <div className="confirm-heading">
          <h2 id={`${id}-title`}>{title}</h2>
          <button type="button" className="dialog-close" aria-label="关闭确认" disabled={busy} onClick={onCancel}>
            <Icon name="x" />
          </button>
        </div>
        {children ? (
          <div id={`${id}-text`} className="confirm-description">
            {children}
          </div>
        ) : null}
        {problem ? (
          <p className="confirm-error" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="button button--secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`button ${tone === "danger" ? "button--danger-solid" : "button--primary"}`}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "正在处理…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
