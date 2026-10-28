import type { ProcessEvent } from "../../api/process";
import type { TaskStatus } from "../../domain/task";

export type Activity = ProcessEvent & { startedAt: string; executionStatus?: string };
export function activitiesOf(events: (ProcessEvent & { executionStatus?: string })[]): Activity[] {
  const activities = new Map<string, Activity>();
  for (const entry of events) {
    const key = `${entry.origin}:${entry.event.activity}`;
    const previous = activities.get(key);
    activities.set(key, { ...entry, startedAt: previous?.startedAt ?? entry.at });
  }
  return [...activities.values()];
}

export function activityState(activity: Activity, taskStatus: TaskStatus) {
  const state = activity.event.status;
  if (state !== "running") return state;
  if (["failed", "superseded"].includes(activity.executionStatus ?? "")) return "failed";
  if (activity.executionStatus === "canceled") return "canceled";
  if (["succeeded", "done"].includes(activity.executionStatus ?? "")) return "interrupted";
  if (taskStatus === "paused") return "paused";
  if (taskStatus === "canceled") return "canceled";
  if (taskStatus === "completed") return "interrupted";
  return "running";
}

/** 单个动作可能完成，但整次服务运行失败；摘要不能把它显示成整组成功。 */
export function summaryState(activity: Activity, status: TaskStatus) {
  if (["failed", "superseded"].includes(activity.executionStatus ?? "")) return "failed";
  if (activity.executionStatus === "canceled") return "canceled";
  return activityState(activity, status);
}
