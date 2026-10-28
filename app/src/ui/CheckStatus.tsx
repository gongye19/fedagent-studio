import { Icon } from "./icons";

export type CheckState = "pending" | "running" | "passed" | "failed" | "skipped";
const LABELS: Record<CheckState, string> = { pending: "待检查", running: "正在检查", passed: "已通过", failed: "未通过", skipped: "未检查" };

/** 状态本身不重复输出成功段落；读屏与悬停仍能辨别每种结果。 */
export function CheckStatus({ status, label }: { status: CheckState; label?: string }) {
  return <span className={`check-status check-status--${status}`} role="img" aria-label={label ?? LABELS[status]} title={label ?? LABELS[status]}>
    {status === "running" ? <span className="check-status-spinner" />
      : status === "passed" ? <Icon name="check" />
        : status === "failed" ? <Icon name="x" /> : <span className="check-status-dot" />}
  </span>;
}

export function CheckRows({ items }: { items: readonly { resource: string; status: CheckState; message?: string }[] }) {
  return <ul className="check-rows" aria-label="检查状态" aria-live="polite">
    {items.map((item, index) => <li className="check-row" key={`${index}:${item.resource}`}>
      <CheckStatus status={item.status} />
      <div className="check-row-content">
        <span>{item.resource}</span>
        {item.status === "failed" && item.message ? <p className="field-error" role="alert">{item.message}</p> : null}
      </div>
    </li>)}
  </ul>;
}
