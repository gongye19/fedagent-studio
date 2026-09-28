/** 任务相关的展示文字：状态色、当前步骤、摘要、指标名、轮次和产出版本的叫法，以及列表排序。 */
import { algorithmOf, scenarioOf, TASK_TYPES, type Algorithm } from "../domain/catalog";
import type { LibraryVersion, Task } from "../domain/task";
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

export function algorithmOfTask(task: Task): Algorithm {
  return algorithmOf(task.config.algorithm);
}

/** 任务的主要指标，由任务类型决定（数学推理是准确率）。 */
export function metricOf(task: Task): string {
  return TASK_TYPES[algorithmOfTask(task).accepts[0]].metric;
}

/** 当前停在哪一轮哪一步；完成的任务返回 null。步骤名由算法定义。 */
export function stageText(task: Task): string | null {
  if (!task.cursor) return null;
  const cursor = task.cursor;
  const stage = algorithmOfTask(task).stages.find((item) => item.id === cursor.stage);
  return `第 ${cursor.round} / ${task.config.rounds} 轮 · ${stage?.label ?? ""}`;
}

/** 列表和详情页标题下的一行摘要：场景 · 算法 · 参与方数 · 运行方式。 */
export function taskSummary(task: Task): string {
  const mode = task.config.mode === "trial" ? "试跑" : "正式运行";
  return `${scenarioOf(task.config.scenario).short} · ${algorithmOfTask(task).name} · ${task.members.length} 个参与方 · ${mode}`;
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

/** 表头用的短写法：第 1 轮标"（本地）"，最后一轮标"（联邦）"；窄屏时括号里的说明收起。 */
export function roundHeader(round: number, last = false): { main: string; note?: string } {
  if (round === 1) return { main: "第 1 轮", note: "（本地）" };
  return last ? { main: `第 ${round} 轮`, note: "（联邦）" } : { main: `第 ${round} 轮` };
}

export function versionLabel(task: Task, version: LibraryVersion): string {
  const final = task.status === "completed" && version.builtAfterRound === task.config.rounds;
  return final ? `第 ${version.builtAfterRound} 轮后（最终）` : `第 ${version.builtAfterRound} 轮后`;
}
