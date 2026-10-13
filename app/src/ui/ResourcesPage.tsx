import { Fragment, useState } from "react";
import { ALGORITHMS, TASK_TYPES } from "../domain/catalog";
import { HOSTING_LABELS, PARTICIPANT_STATUS, type Dataset, type ResourceSpace } from "../domain/resources";
import { deleteDataResource } from "../state/actions";
import { hrefOf, navigate, type ResourceKind, type Route } from "../state/route";
import type { State } from "../state/store";
import { Collapsible, Confirm, Facts, PageHead, PanelEmpty, SearchInput, TabLinks, Tag } from "./common";
import { Panel } from "./console";
import { DataResourceForm } from "./DataResourceForm";
import { EndpointForm } from "./EndpointPage";
import { TaskTypeSelect, type TaskTypeFilter } from "./filters";
import { formatNumber } from "./format";
import { Icon } from "./icons";
import { InfoTip } from "./InfoTip";
import { LocalConnect } from "./ParticipantsPage";
import { ResourceDialog } from "./ResourceDialog";
import { useContentMotion } from "./hooks";

const KIND_LABELS: Record<ResourceKind,string> = {data:"数据",models:"模型接口",agents:"Agent / 执行环境"};
export default function ResourcesPage({state,space="workspace",kind="data",selectedId}: {
  state: State; space?: ResourceSpace; kind?: ResourceKind; selectedId?: string;
}) {
  const [query,setQuery] = useState("");const [taskType,setTaskType] = useState<TaskTypeFilter>("all");
  const [adding,setAdding] = useState<"data"|"model"|null>(null);const [busy,setBusy] = useState(false);
  const panelMotion = useContentMotion(`${space}:${kind}`,true);
  const own = space === "workspace";const keyword = query.trim().toLowerCase();
  const route = (k:ResourceKind,id?:string):Route => ({page:"resources",space,kind:k,id});
  const data = state.datasets.filter(d => d.resourceSpace === space && (!keyword || d.name.toLowerCase().includes(keyword)) && (taskType==="all" || d.taskType===taskType));
  const models = state.endpoints.filter(e => e.resourceSpace === space && (!keyword || `${e.name} ${e.models.join(" ")}`.toLowerCase().includes(keyword)));
  const agents = state.participants.filter(p => p.hosting==="local" && !p.builtin && (!keyword || p.name.toLowerCase().includes(keyword)) && (taskType==="all" || state.datasets.some(d=>d.participantId===p.id&&d.taskType===taskType)));
  const flows = ALGORITHMS.filter(a => (!keyword || a.name.toLowerCase().includes(keyword)) && (taskType==="all" || a.accepts.includes(taskType)));
  const title = own ? "我的资源" : "公用资源";
  return <>
    <PageHead title={title} meta={own ? "接入一次，后续任务可直接选择使用。" : "平台提供的基准数据、模型与执行流程。"}
      actions={own && kind!=="agents" ? <button type="button" className="button button--primary" onClick={()=>setAdding(kind==="data"?"data":"model")}><Icon name="plus" />{kind==="data"?"接入数据":"接入模型接口"}</button> : undefined} />
    <div className="resource-space-bar"><a className={own ? "resource-space-link resource-space-link--active" : "resource-space-link"} href={hrefOf({page:"resources",space:"workspace",kind})}>我的资源</a>
      <a className={!own ? "resource-space-link resource-space-link--active" : "resource-space-link"} href={hrefOf({page:"resources",space:"public",kind})}>公用资源</a>
      {own ? <InfoTip label="资源归属">当前平台共用一个工作区，“我的资源”是此工作区接入的数据、模型接口和本地执行连接；多用户账号隔离尚未开放。平台运行的数据会存入这个工作区。</InfoTip> : null}
    </div>
    <TabLinks label="资源类型" active={kind} routeOf={route} tabs={(Object.keys(KIND_LABELS) as ResourceKind[]).map(k=>({id:k,label:KIND_LABELS[k]}))} />
    <div className="list-toolbar" role="search" aria-label="筛选资源"><SearchInput name="resource-search" aria-label="搜索资源" placeholder="搜索资源名称…" value={query} onChange={e=>setQuery(e.target.value)} />
      {kind!=="models" ? <TaskTypeSelect value={taskType} onChange={setTaskType} /> : null}
      {query || taskType!=="all" ? <button type="button" className="button button--ghost button--compact" onClick={()=>{setQuery("");setTaskType("all");}}>清除筛选</button> : null}
    </div>
    <div ref={panelMotion}>{kind==="data" ? <Panel title="数据" extra={`${data.length} 份`} flush>
      {data.length ? <div className="table-shell"><table className="table table--stack table--resources"><thead><tr><th scope="col">数据名称</th><th scope="col">任务类型</th><th scope="col">运行位置</th><th scope="col" className="numeric">样本数</th></tr></thead><tbody>
        {data.map(d=>{const p=state.participants.find(p=>p.id===d.participantId);const open=selectedId===d.id;return <Fragment key={d.id}>
          <tr className={open?"row--open":undefined}><th scope="row"><button type="button" className="row-button" aria-expanded={open} onClick={()=>navigate(route("data",open?undefined:d.id),{keepScroll:true})}><Icon name="chevron" /><span>{d.name}</span></button></th>
            <td data-label="任务类型">{TASK_TYPES[d.taskType]?.label??d.taskType}</td><td data-label="运行位置">{p ? HOSTING_LABELS[p.hosting] : "来源已删除"}</td><td className="numeric" data-label="样本数">{d.ready ? formatNumber(d.count) : <Tag tone="warning">待连接</Tag>}</td></tr>
          {open ? <tr className="detail-row"><td colSpan={4}><DataDetail state={state} dataset={d} onRemoved={()=>navigate(route("data"),{keepScroll:true})} /></td></tr> : null}
        </Fragment>})}
      </tbody></table></div> : <PanelEmpty>{query || taskType!=="all" ? "没有匹配的数据。" : own ? "还没有接入数据。可以在这里添加，也可以选择算法后在任务配置中提交。" : "没有可用的公用数据。"}
        {own ? <button type="button" className="button button--secondary" onClick={()=>setAdding("data")}>接入数据</button> : null}
      </PanelEmpty>}
    </Panel> : kind==="models" ? <Panel title="模型接口" extra={`${models.length} 个`} flush>
      {models.length ? <div className="table-shell"><table className="table table--stack"><thead><tr><th scope="col">接口名称</th><th scope="col">模型</th><th scope="col">配置状态</th>{own ? <th scope="col">操作</th> : null}</tr></thead><tbody>
        {models.map(e=><tr key={e.id}><th scope="row">{e.name}</th><td data-label="模型">{e.models[0]??"未选择"}</td><td data-label="配置状态">{e.configured ? "已配置" : <Tag tone="warning">待配置</Tag>}</td>{own ? <td data-label="操作"><a className="text-link" href={hrefOf({page:"editEndpoint",id:e.id})}>编辑</a></td> : null}</tr>)}
      </tbody></table></div> : <PanelEmpty>{keyword ? "没有匹配的模型接口。" : own ? "可以使用公用模型，也可以接入自己的模型接口。" : "暂无公用模型。"}</PanelEmpty>}
    </Panel> : own ? <Panel title="本地执行环境" extra={`${agents.length} 个`}>
      {agents.length ? <div className="panel-stack">{agents.map(p=><Collapsible key={p.id} title={p.name} sub={PARTICIPANT_STATUS[p.status]}>
        <Facts items={[["已安装算法",Object.entries(p.clientPlugins).map(([id,version])=>`${ALGORITHMS.find(a=>a.id===id)?.name??id} ${version}`).join("、") || "等待客户端上报"]]} />
        <LocalConnect participantId={p.id} datasetIds={state.datasets.filter(d=>d.participantId===p.id).map(d=>d.id)} />
      </Collapsible>)}</div> : <PanelEmpty>接入数据时选择“本地客户端”，即可登记自己的执行环境。自有 Agent 服务接口尚未开放。</PanelEmpty>}
    </Panel> : <Panel title="平台执行流程" extra={`${flows.length} 个`} flush>
      {flows.length ? <div className="table-shell"><table className="table table--stack"><thead><tr><th scope="col">执行流程</th><th scope="col">适用任务</th><th scope="col">使用方式</th></tr></thead><tbody>{flows.map(a=><tr key={a.id}><th scope="row">{a.requirements.executionLabel}</th><td data-label="适用任务">{a.accepts.map(t=>TASK_TYPES[t]?.label??t).join("、")}</td><td data-label="使用方式">选择对应算法，由平台或已安装插件的本地客户端执行</td></tr>)}</tbody></table></div> : <PanelEmpty>没有匹配的执行流程。</PanelEmpty>}
    </Panel>}</div>
    {state.draft.touched && state.draft.algorithm ? <div className="resource-return"><a className="text-link" href={hrefOf({page:"newTask",scenario:state.draft.scenario??undefined})}>返回任务配置</a></div> : null}
    <ResourceDialog open={adding!==null} busy={busy} title={adding==="data"?"接入我的数据":"接入我的模型接口"} onOpenChange={value=>{if(!value)setAdding(null);}}>
      {adding==="data" ? <DataResourceForm state={state} onBusyChange={setBusy} onCancel={()=>setAdding(null)} onSaved={r=>{setAdding(null);navigate(route("data",r.dataset.id));}} /> : adding==="model" ? <EndpointForm state={state} onBusyChange={setBusy} onCancel={()=>setAdding(null)} onSaved={()=>setAdding(null)} /> : null}
    </ResourceDialog>
  </>;
}

function DataDetail({state,dataset,onRemoved}:{state:State;dataset:Dataset;onRemoved:()=>void}) {
  const [removing,setRemoving]=useState(false);const source=state.participants.find(p=>p.id===dataset.participantId);
  return <div className="participant-detail">
    <Facts items={[["数据来源",source?.name??"来源已删除"],["数据规范",dataset.schemaVersion],["已标注",`${dataset.answered} / ${dataset.count}`],["说明",dataset.description || "—"]]} />
    {dataset.sample ? <Collapsible title="样本预览" className="sample-preview"><div className="sample-question">{dataset.sample.fields?.length ? dataset.sample.fields.map(f=><div key={f.label}><strong>{f.label}</strong><p>{f.text}</p></div>) : <><p>{dataset.sample.question}</p>{dataset.sample.answer ? <p className="sample-answer">标注：{dataset.sample.answer}</p> : null}</>}</div></Collapsible> : null}
    {source?.hosting==="local" ? <LocalConnect participantId={source.id} datasetIds={state.datasets.filter(d=>d.participantId===source.id).map(d=>d.id)} /> : null}
    {dataset.resourceSpace==="workspace" ? <div className="detail-actions"><button type="button" className="button button--secondary button--compact button--danger" onClick={()=>setRemoving(true)}>删除数据</button></div> : null}
    {removing ? <Confirm title={`删除“${dataset.name}”？`} confirmLabel="删除" onCancel={()=>setRemoving(false)} onConfirm={async()=>{await deleteDataResource(dataset.id);onRemoved();}}>只删除这份数据的登记。已运行任务的记录保留，本地客户端连接也会保留。</Confirm> : null}
  </div>;
}
