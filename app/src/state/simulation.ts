/**
 * 模拟运行：有运行中的任务时，每个节拍推进一次（参与方步骤完成一部分题目，服务端步骤走一拍）。
 * 模拟是加速的，一次完整任务在一两分钟内跑完；真实运行的时长以确认页的预估为准。
 */
import { useEffect, type Dispatch } from "react";
import type { Action, State } from "./store";

export const TICK_MS = 900;

export function useSimulation(state: State, dispatch: Dispatch<Action>): void {
  const running = state.tasks.some((task) => task.status === "running");
  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => dispatch({ type: "tick", now: new Date().toISOString() }), TICK_MS);
    return () => window.clearInterval(timer);
  }, [running, dispatch]);
}
