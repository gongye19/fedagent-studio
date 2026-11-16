import { TASK_TYPES, visibleApplicationType } from "./catalog";
import { MEDICAL_RECORDS } from "./consultation";

export const LIFESTYLE_RECORDS = "lifestyle-records";

/** 应用从已安装的任务类型发现；不重复注册浏览器内的假应用。 */
export function applicationEntries() {
  return Object.keys(TASK_TYPES).filter(visibleApplicationType)
    .sort((a, b) => Number(b === MEDICAL_RECORDS) - Number(a === MEDICAL_RECORDS))
    .map((id) => ({
    id, label: TASK_TYPES[id].label,
    summary: id === MEDICAL_RECORDS ? "选择已发布的经验包，开始问诊并连续追问。"
      : id === LIFESTYLE_RECORDS ? "结合个人情况，对比有无经验的饮食与运动建议。"
      : "使用已发布的经验包处理新输入。",
  }));
}
