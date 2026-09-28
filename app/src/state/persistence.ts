/**
 * 演示数据保存在浏览器本地（localStorage），刷新页面后任务和进度都还在。
 * 版本不符或内容损坏时回到初始数据（版本 2 起模型接口改为预留的默认接口，版本 3 起题库说明与来源分开）。旧版原型（7 个维度）的数据用的是另一个键，不会读到。
 */
import { seedState } from "./seed";
import { STATE_VERSION, type State } from "./store";

const KEY = "federation-studio:agent-platform";

export function loadState(): State {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as State;
    if (parsed?.version !== STATE_VERSION || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.participants)) return seedState();
    return parsed;
  } catch {
    return seedState();
  }
}

export function saveState(state: State): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 存储不可用（隐私模式或配额已满）时只保留在内存中。
  }
}
