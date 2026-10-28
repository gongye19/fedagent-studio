import { useState } from "react";
import type { ProcessEvent } from "../../api/process";
import { isActive, stagesOf, type Task } from "../../domain/task";
import { Panel } from "../console";
import { SelectField } from "../SelectField";
import { InfoTip } from "../InfoTip";
import { Icon } from "../icons";
import { activitiesOf, activityState, summaryState } from "./process-model";
import { ActivityMark, ProcessTimeline } from "./ProcessTimeline";
import { useProcess } from "./useProcess";

export function ProcessPanel({ task }: { task: Task }) {
  const [chosenRound, setRound] = useState<number | null>(null);
  const [site, setSite] = useState("");
  const round = chosenRound ?? task.cursor?.round ?? task.config.rounds;
  const query = useProcess(task, round, site);
  const rows = query.data?.events ?? [];
  const members = task.members.filter((m) => !site || m.participantId === site);
  return <Panel title={<>执行过程<InfoTip label="执行过程">展示服务明确回传的实际动作与结果，不包含隐藏推理。旧任务或未提供过程接口的服务可能没有细分记录。</InfoTip></>}>
    <div className="process-filters">
      <SelectField aria-label="过程轮次" value={round} onValueChange={(v) => setRound(Number(v))}>
        {Array.from({ length: task.config.rounds }, (_, i) => <option value={i + 1} key={i}>第 {i + 1} 轮</option>)}
      </SelectField>
      <SelectField aria-label="过程资源" value={site} onValueChange={setSite}>
        <option value="">全部资源</option>
        {task.members.map((m) => <option key={m.participantId} value={m.participantId}>{m.agentName || m.participant}</option>)}
      </SelectField>
    </div>
    {query.isPending ? <p className="section-meta">正在读取过程…</p> : query.isError ? <p className="field-error">过程记录读取失败 <button className="link-button" onClick={() => void query.refetch()}>重试</button></p> : !rows.length ? <p className="section-meta">{isActive(task) ? "等待执行事件，收到后自动展示" : "该轮未记录细分过程"}</p> : <div className="process-resources">
      {members.map((member) => {
        const events = rows.filter((row) => row.site === member.participantId);
        return events.length ? <ResourceProcess key={member.participantId} task={task} name={member.agentName || member.participant} dataset={member.dataset} events={events} /> : null;
      })}
      {rows.some((r) => r.site === "server") ? <ResourceProcess task={task} name="平台汇总" events={rows.filter((r) => r.site === "server")} /> : null}
    </div>}
  </Panel>;
}

function ResourceProcess({ task, name, dataset, events }: { task: Task; name: string; dataset?: string; events: ProcessEvent[] }) {
  const activities = activitiesOf(events);
  const active = activities.filter((a) => activityState(a, task.status) === "running").at(-1) ?? activities.at(-1)!;
  const [open, setOpen] = useState(isActive(task));
  const [visibleCases, setVisibleCases] = useState(8);
  const steps = [...new Set(activities.map((a) => a.step))];
  return <details className="process-resource" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
    <summary><Icon name="chevron" /><strong>{name}</strong><span className="process-resource-dataset">{dataset}</span>
      <span className="process-current"><ActivityMark activity={active} status={task.status} summary />{summaryState(active, task.status) === "failed" ? "本次执行未完成" : summaryState(active, task.status) === "canceled" ? "已取消" : active.event.title}</span></summary>
    <div className="process-resource-body">
      {steps.map((step) => {
        const entries = activities.filter((a) => a.step === step);
        const cases = [...new Set(entries.map((a) => a.event.item_id).filter(Boolean))];
        const general = entries.filter((a) => !a.event.item_id);
        const shown = new Set([...cases.slice(-visibleCases), ...entries.filter((a) => activityState(a, task.status) === "running").map((a) => a.event.item_id)]);
        return <section className="process-stage" key={step}>
          <h3>{stagesOf(task).find((s) => s.id === step)?.label || step}</h3>
          {general.length ? <ProcessTimeline activities={general} status={task.status} /> : null}
          {cases.filter((id) => shown.has(id)).map((id) => <CaseProcess key={id} id={id!} activities={entries.filter((a) => a.event.item_id === id)} task={task} />)}
          {cases.length > visibleCases ? <button className="link-button" onClick={() => setVisibleCases((v) => v + 8)}>显示更早的样本</button> : null}
        </section>;
      })}
    </div>
  </details>;
}

function CaseProcess({ id, activities, task }: { id: string; activities: ReturnType<typeof activitiesOf>; task: Task }) {
  const active = activities.filter((a) => activityState(a, task.status) === "running").at(-1) ?? activities.at(-1)!;
  const [open, setOpen] = useState(activityState(active, task.status) === "running");
  return <details className="process-case" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
    <summary><Icon name="chevron" /><span>样本 {id}</span><span className="process-current"><ActivityMark activity={active} status={task.status} summary />{summaryState(active, task.status) === "failed" ? "本次执行未完成" : summaryState(active, task.status) === "canceled" ? "已取消" : active.event.title}</span></summary>
    <ProcessTimeline activities={activities} status={task.status} />
  </details>;
}
