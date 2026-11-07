import { TASK_TYPES, visibleTaskType } from "../domain/catalog";
import { MEDICAL_RECORDS } from "../domain/consultation";
import { hrefOf } from "../state/route";
import { Panel } from "./console";

export function ApplicationCards() {
  const applications = Object.entries(TASK_TYPES).filter(([id, type]) => type.recordBased && visibleTaskType(id));
  return (
    <div className="application-cards">
      {applications.map(([id, type]) => (
        <Panel key={id} title={type.label}>
          <p>{id === MEDICAL_RECORDS ? "选择已发布的经验包，开始问诊并连续追问。" : "使用已发布的经验包处理新输入。"}</p>
          <a className="button button--primary" aria-label={`进入${type.label}应用`}
            href={hrefOf(id === MEDICAL_RECORDS ? { page: "consultation" } : { page: "application", taskType: id })}>进入应用</a>
        </Panel>
      ))}
    </div>
  );
}
