import type { Estimate } from "../../domain/config";
import { formatDuration, formatNumber, formatTokens, formatYuan } from "../format";

export function EstimateBlock({ result, pending = false, remoteExecution = false, priceHref, serverModelLabel = "平台模型" }: { result: Estimate | null; pending?: boolean; remoteExecution?: boolean; priceHref: string; serverModelLabel?: string }) {
  const ready = pending ? null : result;
  if (remoteExecution)
    return (
      <div className="summary-estimate" aria-busy={pending}>
        <h3>预估</h3>
        <p className="muted">
          Agent 内部的调用量、耗时与费用由服务自行管理，平台无法估算。{serverModelLabel}
          {ready ? ready.serverCalls ? `${ready.callsAreUpperBound ? "最多" : "至少"}调用 ${ready.serverCalls} 次。` : "不产生调用。" : "调用量待配置完成后估算。"}
        </p>
      </div>
    );
  return (
    <div className="summary-estimate" aria-busy={pending}>
      <h3>预估</h3>
      <dl className="summary-list">
        <div>
          <dt>参与方调用</dt>
          <dd>
            {ready ? <>{ready.callsAreUpperBound ? "最多 " : ""}{formatNumber(ready.participantCalls)} 次</> : "—"}
          </dd>
        </div>
        <div>
          <dt>服务端调用</dt>
          <dd>
            {ready ? <>{ready.serverCalls ? ready.callsAreUpperBound ? "最多 " : "至少 " : ""}{ready.serverCalls} 次</> : "—"}
          </dd>
        </div>
        <div>
          <dt>Token</dt>
          <dd>{ready ? <>约 {formatTokens(ready.participantTokens + ready.serverTokens)}</> : "—"}</dd>
        </div>
        <div>
          <dt>时长</dt>
          <dd>{ready ? formatDuration(ready.seconds) : "—"}</dd>
        </div>
        <div>
          <dt>费用</dt>
          <dd>
            {!ready ? "—" : ready.cost === null ? (
              <a className="text-link" href={priceHref}>
                未设置单价
              </a>
            ) : (
              formatYuan(ready.cost)
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
