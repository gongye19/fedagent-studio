import { TASK_TYPES, visibleApplicationType } from "./catalog";
import { MEDICAL_RECORDS } from "./consultation";

export const LIFESTYLE_DEMO = "lifestyle";

/** 应用入口不等于可运行的算法任务；演示应用不进入后端任务注册表。 */
export function applicationEntries() {
  return [...Object.keys(TASK_TYPES).filter(visibleApplicationType).map((id) => ({
    id, label: TASK_TYPES[id].label, demo: false,
    summary: id === MEDICAL_RECORDS ? "选择已发布的经验包，开始问诊并连续追问。" : "使用已发布的经验包处理新输入。",
  })), {id:LIFESTYLE_DEMO, label:"LifeStyle", demo:true, summary:"从体检案例到共享经验，预览用户收到的健康提示。"}];
}
