/** 任务相关的展示文字：状态色、当前步骤、摘要、轮次和洞见库版本的叫法，以及列表排序。 */
import { algorithmOf, stageOf } from "../domain/catalog";
import { totalProblems, type LibraryVersion, type Task } from "../domain/task";
import type { Tone } from "./common";

export function statusTone(task: Task): Tone {
  switch (task.status) {
    case "running":
      return "info";
    case "paused":
      return "warning";
    default:
      return "neutral";
  }
}

/** 当前停在哪一轮哪一步；完成的任务返回 null。 */
export function stageText(task: Task): string | null {
  if (!task.cursor) return null;
  return `第 ${task.cursor.round} / ${task.config.rounds} 轮 · ${stageOf(task.cursor.stage).label}`;
}

/** 列表和详情页标题下的一行摘要。场景由算法决定（FoT 只属于横向），不再重复。 */
export function taskSummary(task: Task): string {
  const mode = task.config.mode === "trial" ? "试跑" : "正式运行";
  return `${algorithmOf(task.config.algorithm).name} · ${task.members.length} 方 · ${totalProblems(task)} 题 · ${mode}`;
}

/** 运行中、暂停的任务排在前面，其余按创建时间从新到旧。 */
export function sortTasks(tasks: readonly Task[]): Task[] {
  const rank = (task: Task) => (task.status === "running" ? 0 : task.status === "paused" ? 1 : 2);
  return [...tasks].sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

/** 嵌进中文句子的名称：以英文或数字开头 / 结尾时补一个空格，中文开头就不加。 */
export function inline(text: string): string {
  const start = /^[A-Za-z0-9]/.test(text) ? " " : "";
  const end = /[A-Za-z0-9)]$/.test(text) ? " " : "";
  return `${start}${text}${end}`;
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
