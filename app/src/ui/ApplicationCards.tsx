import { TASK_TYPES, visibleApplicationType } from "../domain/catalog";
import { MEDICAL_RECORDS } from "../domain/consultation";
import { applicationRoute, hrefOf } from "../state/route";
import { Panel } from "./console";

export function ApplicationCards() {
  const applications = Object.keys(TASK_TYPES).filter(visibleApplicationType);
  return (
    <div className="application-cards">
      {applications.map((id) => (
        <Panel key={id} title={TASK_TYPES[id].label}>
          <p>{id === MEDICAL_RECORDS ? "选择已发布的经验包，开始问诊并连续追问。" : "使用已发布的经验包处理新输入。"}</p>
          <a className="button button--primary" aria-label={`进入${TASK_TYPES[id].label}应用`}
            href={hrefOf(applicationRoute(id))}>进入应用</a>
        </Panel>
      ))}
    </div>
  );
}
