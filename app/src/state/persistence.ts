/**
 * 演示数据保存在浏览器本地（localStorage），刷新页面后项目和进度都还在。
 * 版本不符或内容损坏时回到体验模式的初始数据；检查中的上传无法续上，加载时丢弃。
 */
import { STATE_VERSION, type State } from "./store";
import { seedState } from "./seed";

const KEY = "federation-studio:state";

export function sanitize(state: State): State {
  return {
    ...state,
    projects: state.projects.map((project) => ({
      ...project,
      uploads: project.uploads.filter((upload) => upload.status !== "checking"),
    })),
  };
}

export function loadState(): State {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as State;
    if (parsed?.version !== STATE_VERSION || !Array.isArray(parsed.projects)) return seedState();
    return sanitize(parsed);
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
