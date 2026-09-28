import type { FrontendRunPlan } from "../domain/plan";

/**
 * 只读的配置清单：7 个维度的取值 + 平台推导项。项目配置页和邀请页共用。
 * perspective 为 participant 时，"我方部署位置"指的是发起方，改名以免误解。
 */
export default function ConfigSummary({ plan, perspective = "initiator" }: { plan: FrontendRunPlan; perspective?: "initiator" | "participant" }) {
  return (
    <div className="config-summary">
      {plan.groups.map((group) => (
        <section className="config-summary-group" key={group.dimension} aria-labelledby={`summary-${group.dimension}`}>
          <h3 id={`summary-${group.dimension}`}><span aria-hidden="true">{group.dimension}</span>{group.title}</h3>
          <dl>
            {group.rows.map((row) => (
              <div key={row.code}>
                <dt>{perspective === "participant" && row.title === "我方部署位置" ? "发起方部署位置" : row.title}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <section className="config-summary-group" aria-labelledby="summary-derived">
        <h3 id="summary-derived">平台推导</h3>
        <dl>
          <div><dt>执行框架</dt><dd>{plan.runner}</dd></div>
          <div><dt>执行模式</dt><dd>{plan.patternLabel}</dd></div>
          <div><dt>交换对象</dt><dd>{plan.exchanged}</dd></div>
          <div><dt>资源</dt><dd>{plan.estimate.resources}</dd></div>
          <div><dt>预计耗时</dt><dd>{plan.estimate.duration}</dd></div>
        </dl>
      </section>
    </div>
  );
}
