import type { State } from "../state/store";
import { PageHead } from "./common";
import { ApplicationCards } from "./ApplicationCards";
import { hrefOf } from "../state/route";
import { TASK_TYPES } from "../domain/catalog";

export default function AppsPage({state}: {state:State}) {
  const historical=state.published.filter(p=>!TASK_TYPES[p.taskType]?.recordBased);
  return <>
    <PageHead title="应用" meta="选择应用，管理经验库并试用。" />
    <ApplicationCards />
    {historical.length ? <details className="algorithm-explanation"><summary>历史发布</summary>
      <ul>{historical.map(p=><li key={p.id}><a href={hrefOf({page:"app",id:p.id})}>{p.name}</a></li>)}</ul>
    </details>:null}
  </>;
}
