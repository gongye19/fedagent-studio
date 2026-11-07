import { TASK_TYPES } from "../domain/catalog";
import { hrefOf } from "../state/route";
import { Panel } from "./console";

export function ApplicationCards() {
  return <div className="application-cards">{Object.entries(TASK_TYPES).filter(([,type]) => type.recordBased).map(([id,type]) =>
    <Panel key={id} title={type.label}>
      <p>上传{type.label}过程记录，由平台提取和聚合经验，供应用使用。</p>
      <a className="button button--primary" href={hrefOf({page:"application",taskType:id})}>进入应用</a>
    </Panel>
  )}</div>;
}
