/** 新建任务的草稿保存在浏览器本地：刷新页面、去新增参与方再回来，配置还在。 */
import { DEFAULT_DRAFT, withDefaults, type Draft } from "../domain/config";

const KEY = "fedagent-studio:draft";
const SELECTION_VERSION = 1;

/** 旧草稿无法区分模型默认值与主动选择；升级时仅要求重新选择模型。 */
export function decodeDraft(raw: string): Draft {
  const stored = JSON.parse(raw) as Partial<Draft> & { selectionVersion?: number };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return DEFAULT_DRAFT;
  const { selectionVersion, ...draft } = stored;
  return withDefaults(selectionVersion === SELECTION_VERSION ? draft : {
    ...draft, clientModel: "", serverModel: "", clientOverrides: {},
  });
}

export function loadDraft(): Draft {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? decodeDraft(raw) : DEFAULT_DRAFT;
  } catch {
    return DEFAULT_DRAFT;
  }
}

export function saveDraft(draft: Draft): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...draft, selectionVersion: SELECTION_VERSION }));
  } catch {
    // 存储不可用（隐私模式或配额已满）时只保留在内存中。
  }
}
