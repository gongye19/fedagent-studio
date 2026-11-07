import { TASK_TYPES, algorithmOf } from "../domain/catalog";
import { hrefOf } from "../state/route";
import type { State } from "../state/store";
import { NotFound, PageHead, PanelEmpty } from "./common";
import { Panel } from "./console";
import { formatDate } from "./format";

export default function ApplicationPage({state,taskType}:{state:State;taskType:string}) {
  const definition=TASK_TYPES[taskType];
  if(!definition?.recordBased) return <NotFound kind="应用" back={{page:"apps"}} backLabel="应用" />;
  const libraries=state.published.filter(p=>p.taskType===taskType);
  return <>
    <PageHead title={definition.label} back={{label:"应用",route:{page:"apps"}}}
      meta="上传已有过程记录生成经验库，选择经验库后用于新的输入。" />
    <div className="list-toolbar">
      <a className="button button--primary" href={hrefOf({page:"newTask",application:taskType})}>生成经验库</a>
      <a className="button button--secondary" href={hrefOf({page:"resources",kind:"data"})}>上传过程记录</a>
    </div>
    <Panel title="可用经验库" flush>
      {libraries.length ? <div className="table-shell"><table className="table table--stack"><thead><tr>
        <th>经验库</th><th>算法</th><th>发布时间</th><th>操作</th>
      </tr></thead><tbody>{libraries.map(library=><tr key={library.id}>
        <th scope="row">{library.name}</th><td data-label="算法">{algorithmOf(library.algorithm).name}</td>
        <td data-label="发布时间">{formatDate(library.publishedAt)}</td>
        <td data-label="操作"><a className="text-link" href={hrefOf({page:"app",id:library.id})}>使用经验库</a></td>
      </tr>)}</tbody></table></div>:<PanelEmpty>还没有经验库。先上传过程记录，再选择算法生成。</PanelEmpty>}
    </Panel>
  </>;
}
