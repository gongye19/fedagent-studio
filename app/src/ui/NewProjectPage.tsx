import { useState } from "react";
import { buildRunPlan } from "../domain/plan";
import type { Selection } from "../domain/selection";
import { navigate } from "../state/route";
import type { Action } from "../state/store";
import ConfigForm from "./ConfigForm";
import OrderSummary from "./OrderSummary";

/** 新建联邦项目：左侧按 7 个维度选配置，右侧是订单摘要；确认后创建项目并进入组队。 */
export default function NewProjectPage({ draft, dispatch }: { draft: Selection; dispatch: (action: Action) => void }) {
  const [name, setName] = useState("");
  const plan = buildRunPlan(draft);
  const today = new Date();
  const placeholder = plan ? `${plan.scenario.label}-${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}` : "";

  function create() {
    const id = `prj-${Date.now().toString(36)}`;
    dispatch({ type: "createProject", id, name: name || placeholder, createdAt: new Date().toISOString() });
    setName("");
    navigate({ page: "project", id });
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>新建联邦项目</h1>
          <p className="page-lede">按 7 个维度完成配置。每一项都已按场景给出推荐值，可以只修改关心的部分。</p>
        </div>
      </header>
      <div className="order-workspace">
        <ConfigForm selection={draft} onChoose={(item, value) => dispatch({ type: "choose", item, value })} />
        <OrderSummary plan={plan} name={name} placeholder={placeholder} onName={setName} onCreate={create} />
      </div>
      {plan ? (
        <div className="order-bar" aria-label="订单操作">
          <p>
            <strong>{plan.scenario.label}</strong>
            <span>{plan.estimate.resources} · {plan.estimate.duration}</span>
          </p>
          <a className="button button--secondary" href="#order-title" onClick={(event) => {
            event.preventDefault();
            document.getElementById("order-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}>配置清单</a>
          <button type="button" className="button button--primary" onClick={create}>创建项目</button>
        </div>
      ) : null}
    </>
  );
}
