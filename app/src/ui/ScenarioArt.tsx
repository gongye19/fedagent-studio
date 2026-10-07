import { useId } from "react";
import type { ScenarioId } from "../domain/catalog";

const CAPTIONS: Record<string, string> = {
  horizontal: "同类任务 · 各方独立样本",
  vertical: "同一批对象 · 各方互补信息",
  transfer: "已有领域经验 · 迁移至新领域",
};

/** 场景关系图是概念示意，静态呈现，不表示任务实时执行或数据上传。 */
export function ScenarioArt({ scenario }: { scenario: ScenarioId }) {
  const id = useId().replaceAll(":", "");
  return (
    <>
      <span className="scenario-visual">
        <svg viewBox="0 0 320 180" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={`${id}-ink`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--art-strong)" /><stop offset="1" stopColor="var(--art-light)" /></linearGradient>
            <filter id={`${id}-shadow`} x="-30%" y="-40%" width="160%" height="180%"><feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="var(--art-strong)" floodOpacity=".12" /></filter>
          </defs>
          {scenario === "vertical" ? (
            <>
              <path className="art-guide" d="M27 60H290M27 88H290M27 116H290" />
              {[36, 120, 204].map((x, index) => (
                <g key={x} filter={`url(#${id}-shadow)`}>
                  <path className="art-plane" d={`M${x} 42l62-12 12 110-62 12Z`} />
                  <path className="art-plane-edge" d={`M${x + 62} 30l7 5 12 110-7-5Z`} />
                  {[0, 1, 2].map((row) => <path key={row} className="art-column" opacity={.8 - index * .15} d={`M${x + 13} ${59 + row * 27}l35-7 2 9-35 7Z`} />)}
                  <circle className="art-node" cx={x + 33} cy={158} r="4" />
                </g>
              ))}
            </>
          ) : scenario === "transfer" ? (
            <>
              <path className="art-route" d="M101 83C134 39 185 40 221 75" />
              <path className="art-route-arrow" d="M207 71l15 5-4-15" />
              <path className="art-guide" d="M104 113C149 155 185 153 215 132" />
              <g filter={`url(#${id}-shadow)`}>
                {[0, 1, 2].map((n) => <path key={n} className="art-plane" d={`M35 ${80 - n * 14}l46-23 47 23-46 24Z`} />)}
                <path fill={`url(#${id}-ink)`} d="M53 56l28-14 29 14-29 15Z" />
                <circle className="art-node" cx="81" cy="126" r="5" />
                <rect className="art-plane" x="207" y="91" width="67" height="48" rx="12" />
                <rect fill={`url(#${id}-ink)`} x="220" y="105" width="40" height="8" rx="4" />
                <path className="art-guide" d="M222 123H256" />
              </g>
              <circle className="art-spark" cx="158" cy="51" r="4" />
              <circle className="art-node" cx="285" cy="86" r="3" />
            </>
          ) : (
            <>
              <path className="art-route" d="M96 40C159 40 154 90 223 90M96 90H223M96 140C159 140 154 90 223 90" />
              <g filter={`url(#${id}-shadow)`}>
                {[21, 71, 121].map((y, n) => <g key={y}>
                  <rect className="art-plane" x="27" y={y} width="69" height="38" rx="9" />
                  <circle className="art-node" cx="40" cy={y + 12} r="3" opacity={1 - n * .2} />
                  {[0, 1, 2].map((row) => <rect key={row} className="art-row" x="50" y={y + 9 + row * 8} width={row === n ? 31 : 24} height="4" rx="2" />)}
                </g>)}
                <path className="art-plane" d="M223 60l28-16 28 16v60l-28 16-28-16Z" />
                <path fill={`url(#${id}-ink)`} d="M236 81l15-9 15 9v18l-15 9-15-9Z" />
                <path className="art-hub" d="M244 90h14M251 83v14" />
              </g>
              <circle className="art-spark" cx="168" cy="90" r="4" />
              <circle className="art-node" cx="288" cy="46" r="3" />
            </>
          )}
        </svg>
      </span>
      {CAPTIONS[scenario] ? <span className="scenario-art-caption">{CAPTIONS[scenario]}</span> : null}
    </>
  );
}
