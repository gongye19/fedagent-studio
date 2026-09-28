import type { FormEvent } from "react";
import type { FrontendRunPlan } from "../domain/plan";
import { Icon } from "./icons";

type Props = {
  plan: FrontendRunPlan | null;
  name: string;
  placeholder: string;
  onName: (name: string) => void;
  onCreate: () => void;
};

/** 新建项目页右侧的订单摘要：配置清单、平台推导、资源与耗时预估，以及创建按钮。 */
export default function OrderSummary({ plan, name, placeholder, onName, onCreate }: Props) {
  function submit(event: FormEvent) {
    event.preventDefault();
    if (plan) onCreate();
  }

  return (
    <aside className="order-summary" aria-labelledby="order-title">
      <header className="panel-head">
        <h2 id="order-title">配置清单</h2>
        {plan ? <span className="status status--ready">已生成</span> : <span className="status">待选择</span>}
      </header>

      {!plan ? (
        <p className="panel-empty">选择协作场景后生成配置清单，其余配置按推荐值预先选好。</p>
      ) : (
        <div className="order-body">
          {plan.groups.slice(1).map((group) => (
            <section key={group.dimension} className="order-group" aria-labelledby={`order-${group.dimension}`}>
              <h3 id={`order-${group.dimension}`}>
                <a href={`#dimension-${group.dimension}`} onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(`dimension-${group.dimension}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}>{group.dimension} {group.title}</a>
              </h3>
              <dl>
                {group.rows.map((row) => (
                  <div key={row.code}>
                    <dt>{row.title}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          <section className="order-group order-group--derived" aria-labelledby="order-derived">
            <h3 id="order-derived">平台推导</h3>
            <dl>
              <div><dt>场景</dt><dd>{plan.scenario.label}</dd></div>
              <div><dt>执行框架</dt><dd>{plan.runner}</dd></div>
              <div><dt>执行模式</dt><dd>{plan.patternLabel}</dd></div>
              <div><dt>交换对象</dt><dd>{plan.exchanged}</dd></div>
            </dl>
          </section>

          <section className="order-group order-group--estimate" aria-labelledby="order-estimate">
            <h3 id="order-estimate">预估</h3>
            <dl>
              <div><dt>资源</dt><dd>{plan.estimate.resources}</dd></div>
              <div><dt>耗时</dt><dd>{plan.estimate.duration}</dd></div>
              <div><dt>消耗</dt><dd>{plan.estimate.consumption}</dd></div>
            </dl>
          </section>

          {plan.warnings.length ? (
            <ul className="order-warnings" aria-label="注意事项">
              {plan.warnings.map((warning) => (
                <li key={warning}><Icon name="alert" /><span>{warning}</span></li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <form className="order-footer" onSubmit={submit}>
        <label className="field">
          <span>项目名称</span>
          <input
            name="project-name"
            autoComplete="off"
            value={name}
            placeholder={placeholder}
            disabled={!plan}
            onChange={(event) => onName(event.target.value)}
          />
        </label>
        <button type="submit" className="button button--primary button--block" disabled={!plan}>确认配置并创建项目</button>
        <small>创建后配置锁定，下一步组建参与方。</small>
      </form>
    </aside>
  );
}
