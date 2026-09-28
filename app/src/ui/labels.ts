/** 任务相关的展示文字：状态色、当前步骤、摘要、轮次和洞见库版本的叫法。 */
import { algorithmOf, FOT_STAGES, scenarioOf, stageOf } from "../domain/catalog";
import { totalProblems, type LibraryVersion, type Task } from "../domain/task";
import type { Tone } from "./common";

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥"];

export function statusTone(task: Task): Tone {
  switch (task.status) {
    case "running":
      return "info";
    case "paused":
      return "warning";
    case "completed":
      return "success";
    default:
      return "neutral";
  }
}

/** 当前停在哪一轮哪一步。 */
export function stageText(task: Task): string {
  if (!task.cursor) return `${task.config.rounds} 轮全部完成`;
  const index = FOT_STAGES.findIndex((stage) => stage.id === task.cursor?.stage);
  return `第 ${task.cursor.round} / ${task.config.rounds} 轮 · ${CIRCLED[index]} ${stageOf(task.cursor.stage).label}`;
}

export function taskSummary(task: Task): string {
  const mode = task.config.mode === "trial" ? `试跑（每份前 ${task.config.trialCap} 题）` : "正式运行";
  return `${scenarioOf(task.config.scenario).name} · ${algorithmOf(task.config.algorithm).name} · ${task.members.length} 方 · ${totalProblems(task)} 题 · ${mode}`;
}

/** 变化的颜色：上升绿、下降红，持平不着色。 */
export function deltaClass(value: number | null): string {
  if (value === null || Math.abs(value) < 0.0005) return "delta";
  return value < 0 ? "delta delta--down" : "delta delta--up";
}

export function roundLabel(round: number): string {
  return round === 1 ? "第 1 轮（本地）" : `第 ${round} 轮`;
}

/** 表头用的短写法：窄屏时"（本地）"收起。 */
export function roundHeader(round: number): { main: string; note?: string } {
  return round === 1 ? { main: "第 1 轮", note: "（本地）" } : { main: `第 ${round} 轮` };
}

export function versionLabel(task: Task, version: LibraryVersion): string {
  const final = task.status === "completed" && version.builtAfterRound === task.config.rounds;
  return final ? `第 ${version.builtAfterRound} 轮后 · 最终` : `第 ${version.builtAfterRound} 轮后`;
}
