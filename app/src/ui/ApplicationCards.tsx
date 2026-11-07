import { TASK_TYPES } from "../domain/catalog";
import { hrefOf } from "../state/route";
import { Panel } from "./console";

export function ApplicationCards() {
  const applications = Object.entries(TASK_TYPES).filter(([, type]) => type.recordBased);
  return (
    <div className="application-cards">
      {applications.map(([id, type]) => (
        <Panel key={id} title={type.label}>
          <p>上传{type.label}过程记录，生成经验库供应用使用。</p>
          <a className="button button--primary" aria-label={`进入${type.label}应用`}
            href={hrefOf({ page: "application", taskType: id })}>进入应用</a>
        </Panel>
      ))}
    </div>
  );
}
