import type { components } from "../../api/schema";
type Report = components["schemas"]["TaskCheckOut"];

/** 首次报告尚未到达也属于检查中；重测时不展示旧失败，配置不符时不复用结论。 */
export function checkState(submitting: boolean, matches: boolean, pending: boolean, report?: Report) {
  const running = submitting || (matches && (pending || report?.status === "queued" || report?.status === "running"));
  return { running, report: submitting || !matches ? undefined : report };
}
