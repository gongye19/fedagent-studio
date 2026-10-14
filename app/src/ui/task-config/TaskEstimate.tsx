import type { Estimate } from "../../domain/config";
import { formatDuration, formatNumber, formatTokens, formatYuan } from "../format";

export function EstimateBlock({ result, priceHref }: { result: Estimate; priceHref: string }) {
  return (
    <div className="summary-estimate">
      <h3>预估</h3>
      <dl className="summary-list">
        <div>
          <dt>参与方调用</dt>
          <dd>
            {result.callsAreUpperBound ? "最多 " : ""}
            {formatNumber(result.participantCalls)} 次
          </dd>
        </div>
        <div>
          <dt>服务端调用</dt>
          <dd>
            {result.serverCalls ? "至少 " : ""}
            {result.serverCalls} 次
          </dd>
        </div>
        <div>
          <dt>Token</dt>
          <dd>约 {formatTokens(result.participantTokens + result.serverTokens)}</dd>
        </div>
        <div>
          <dt>时长</dt>
          <dd>{formatDuration(result.seconds)}</dd>
        </div>
        <div>
          <dt>费用</dt>
          <dd>
            {result.cost === null ? (
              <a className="text-link" href={priceHref}>
                未设置单价
              </a>
            ) : (
              formatYuan(result.cost)
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
