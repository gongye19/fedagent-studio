/**
 * 演示数据保存在浏览器本地（localStorage），刷新页面后任务和进度都还在。
 * 版本不符或内容损坏时回到初始数据（版本 7 起数据集登记了场景，任务按参与方记录，算法参数按注册表的键保存；版本 8 起应用记下所属场景、任务类型和算法）。旧版原型的数据用的是另一个键，不会读到。
 */
import { seedState } from "./seed";
import { STATE_VERSION, type State } from "./store";

const KEY = "fedagent-studio:agent-platform";

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
