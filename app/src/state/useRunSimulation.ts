import { useEffect } from "react";
import { nextAutoStage, runningStage, type Run } from "../domain/run";
import { stageWork } from "../domain/simulator";
import type { Action } from "./store";

/**
 * 按演示时长推进 Run。编排规则全部在 domain/run.ts，这里只负责计时和派发。
 * StrictMode 下 effect 会执行两次：startStage 只接受 pending 阶段，重复派发是无害的。
 */
export function useRunSimulation(run: Run | null, dispatch: (action: Action) => void) {
  useEffect(() => {
    if (!run || run.error) return;

    const running = runningStage(run);
    if (running) {
      if (running.id === "publish") return;
      const work = stageWork(running.id, run.plan, run.participants, run.preset);
      const timer = setTimeout(() => {
        dispatch({ type: "stageFinish", stage: running.id, result: work });
      }, work.demoMs);
      return () => clearTimeout(timer);
    }

    const next = nextAutoStage(run);
    if (next) dispatch({ type: "stageStart", stage: next });
  }, [run, dispatch]);
}
