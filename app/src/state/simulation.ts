/**
 * 前端模拟的计时器：节点交付、对方机构的组队进度、运行阶段推进、受邀项目的启动与交付。
 *
 * pendingEvents 从状态推导"接下来该发生什么"（纯函数，可测试）；useSimulation 只负责计时和派发。
 * 计时器按事件键登记，状态变化时只增删有变化的事件，已在计时的事件不会被重置。
 * 事件都由状态推导，刷新页面后会自动续上。
 */
import { useEffect, useRef } from "react";
import { deliveryRecipients, readiness } from "../domain/project";
import { nextAutoStage, runningStage, stageOf } from "../domain/run";
import { stageWork } from "../domain/simulator";
import type { Action, State } from "./store";

export type SimEvent = { key: string; delay: number; action: () => Action };

export const NODE_DELIVERY_MS = 1800;
export const MEMBER_STEP_MS = 900;
export const PARTNER_START_MS = 2000;
export const PARTNER_DELIVERY_MS = 1500;

export function pendingEvents(state: State): SimEvent[] {
  const events: SimEvent[] = [];

  for (const node of state.nodes) {
    if (node.status === "provisioning") {
      events.push({ key: `node:${node.id}`, delay: NODE_DELIVERY_MS, action: () => ({ type: "nodeOnline", nodeId: node.id }) });
    }
  }

  for (const project of state.projects) {
    for (const member of project.members) {
      if (member.kind === "partner" && member.simulated && member.status !== "confirmed" && !project.run) {
        events.push({
          key: `member:${project.id}:${member.id}:${member.status}`,
          delay: MEMBER_STEP_MS,
          action: () => ({ type: "advanceMember", projectId: project.id, memberId: member.id }),
        });
      }
    }

    const { run } = project;
    if (!run) {
      // 受邀项目由对方发起方启动：本机构确认后，模拟发起方开始运行。
      if (project.role === "participant" && readiness(project).ready) {
        events.push({
          key: `start:${project.id}`,
          delay: PARTNER_START_MS,
          action: () => ({ type: "startRun", projectId: project.id, runId: `run-${Date.now()}`, createdAt: new Date().toISOString() }),
        });
      }
      continue;
    }
    if (run.error) continue;

    const running = runningStage(run);
    if (running && running.id !== "publish") {
      const work = stageWork(running.id, run.plan, run.participants);
      events.push({
        key: `stage:${project.id}:${run.id}:${running.id}`,
        delay: work.demoMs,
        action: () => ({ type: "stageFinish", projectId: project.id, stage: running.id, result: work }),
      });
      continue;
    }
    const next = nextAutoStage(run);
    if (next) {
      events.push({ key: `start-stage:${project.id}:${run.id}:${next}`, delay: 0, action: () => ({ type: "stageStart", projectId: project.id, stage: next }) });
      continue;
    }
    // 受邀项目的交付由对方发起方确认。
    if (project.role === "participant" && run.evaluation?.passed && stageOf(run, "publish").status === "pending") {
      events.push({
        key: `deliver:${project.id}:${run.id}`,
        delay: PARTNER_DELIVERY_MS,
        action: () => ({ type: "deliver", projectId: project.id, recipients: deliveryRecipients(project) }),
      });
    }
  }
  return events;
}

export function useSimulation(state: State, dispatch: (action: Action) => void) {
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const due = new Map(pendingEvents(state).map((event) => [event.key, event]));
    for (const [key, timer] of timers.current) {
      if (!due.has(key)) {
        window.clearTimeout(timer);
        timers.current.delete(key);
      }
    }
    for (const [key, event] of due) {
      if (timers.current.has(key)) continue;
      const timer = window.setTimeout(() => {
        timers.current.delete(key);
        dispatch(event.action());
      }, event.delay);
      timers.current.set(key, timer);
    }
  }, [state, dispatch]);

  useEffect(() => {
    const active = timers.current;
    return () => {
      for (const timer of active.values()) window.clearTimeout(timer);
      active.clear();
    };
  }, []);
}
