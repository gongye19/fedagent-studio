export const MEDICAL_RECORDS = "medical-records";

export function isConsultationPackage(item: { taskType: string; scenario: string; items: readonly unknown[] }) {
  return item.taskType === MEDICAL_RECORDS && item.scenario === "horizontal" && item.items.length > 0;
}
