import { useState } from "react";
import type { TaskStatus } from "../../domain/task";
import { Icon } from "../icons";
import { formatDuration } from "../format";
import { activitiesOf, activityState, summaryState, type Activity } from "./process-model";

const STATUS = { running: "执行中", completed: "已完成", failed: "未完成", paused: "已暂停", canceled: "已取消", interrupted: "未记录完成" };

export function ActivityMark({ activity, status, summary = false }: { activity: Activity; status: TaskStatus; summary?: boolean }) {
  const value = summary ? summaryState(activity, status) : activityState(activity, status);
  return <span className={`process-mark process-mark--${value}`} role="img" aria-label={STATUS[value]}>
    {value === "running" ? <span className="check-status-spinner" /> : <Icon name={value === "completed" ? "check" : value === "failed" ? "x" : "minus"} />}
  </span>;
}

export function ProcessTimeline({ activities, status }: { activities: ReturnType<typeof activitiesOf>; status: TaskStatus }) {
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState<string[]>([]);
  const keyOf = (a: Activity) => `${a.origin}:${a.event.activity}`;
  const pin = (a: Activity) => setPinned((prev) => prev.includes(keyOf(a)) ? prev : [...prev, keyOf(a)]);
  const visible = expanded ? activities : activities.filter((a, i) => i >= activities.length - 8 || activityState(a, status) === "running" || pinned.includes(keyOf(a)));
  const hidden = activities.length - visible.length;
  return <div>{activities.length > 8 && (expanded || hidden > 0) ? <button className="link-button" onClick={() => { setExpanded((v) => !v); setPinned([]); }}>
    {expanded ? "收起较早的动作" : `查看此前 ${hidden} 个动作`}
  </button> : null}<ol className="process-timeline">
    {visible.map((activity) => {
      const { event } = activity;
      const seconds = (new Date(activity.at).getTime() - new Date(activity.startedAt).getTime()) / 1000;
      const summary = <><strong>{event.title}</strong>{!event.detail && event.summary ? <span>{event.summary}</span> : null}
        {seconds > 0 && event.status !== "running" ? <time>{formatDuration(seconds)}</time> : null}</>;
      return <li key={`${activity.origin}:${event.activity}`} className={event.parent ? "process-child" : ""} onFocusCapture={() => pin(activity)}>
        <ActivityMark activity={activity} status={status} />
        <div className="process-action">
          {event.detail ? <details onToggle={(e) => { if (e.currentTarget.open) pin(activity); }}><summary>{summary}<Icon name="chevron" /></summary>
            <div className="process-detail" lang="en" tabIndex={0} aria-label={`${event.title}详情`}>{event.summary ? <p className="muted">{event.summary}</p> : null}{event.detail}</div>
          </details> : <div className="process-action-summary">{summary}</div>}
        </div>
      </li>;
    })}
  </ol></div>;
}
