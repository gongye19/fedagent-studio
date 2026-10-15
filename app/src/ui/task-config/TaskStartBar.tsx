import { formatDuration, formatNumber } from "../format";
import type { TaskConfigController } from "./useTaskConfig";

export function TaskStartBar({ config }: { config: TaskConfigController }) {
  const {
    pending,
    joined,
    result,
    canCreate,
    creating,
    createError,
    start,
    startLabel,
    validationPending,
    validationError,
    issues,
  } = config;
  return (
    <div className="order-bar" aria-label="创建任务">
      <div>
        <strong>
          {validationPending
            ? "正在检查配置…"
            : result && !issues.length
              ? result.remoteExecution ? `${joined.length} 个数据来源 · 自有 Agent` : `${joined.length} 个数据来源 · ${result.callsAreUpperBound ? "最多" : "至少"} ${formatNumber(result.participantCalls + result.serverCalls)} 次调用`
              : ""}
        </strong>
        {result && !issues.length ? <small>{formatDuration(result.seconds)}</small> : null}
      </div>
      <div className="order-bar-actions">
        <p className="order-bar-error" role="alert">
          {validationError || (pending !== "full" ? createError : null)}
        </p>
        <button
          type="button"
          className="button button--primary"
          disabled={creating || validationPending || config.preflight.running}
          data-ready={canCreate}
          aria-describedby="task-action-status"
          onClick={start}
        >
          {creating ? "正在创建…" : startLabel}
        </button>
      </div>
    </div>
  );
}
