/** 新建任务的草稿保存在浏览器本地：刷新页面、去新增参与方再回来，配置还在。 */
import { DEFAULT_DRAFT, withDefaults, type Draft } from "../domain/config";

const KEY = "fedagent-studio:draft";

export function loadDraft(): Draft {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? withDefaults(JSON.parse(raw) as Partial<Draft>) : DEFAULT_DRAFT;
  } catch {
    return DEFAULT_DRAFT;
  }
}

export function saveDraft(draft: Draft): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // 存储不可用（隐私模式或配额已满）时只保留在内存中。
  }
}
