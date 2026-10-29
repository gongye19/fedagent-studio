import { algorithmOf } from "../catalog";
import type { Dataset } from "../resources";
import type { Draft } from "./types";

/** 同一个上限应用于每份数据，因此不能超过所选最小数据集。 */
export function trialSampleBounds(draft: Draft, datasets: readonly Dataset[]) {
  const selected = draft.execution === "agent" ? draft.agentGroups : draft.participants;
  const counts = selected.flatMap(({ datasetId }) => {
    const dataset = datasets.find((d) => d.id === datasetId);
    return dataset ? [dataset.count] : [];
  });
  return {
    min: (draft.algorithm ? algorithmOf(draft.algorithm).minSamples : 1) ?? 1,
    max: counts.length ? Math.min(...counts) : null,
  };
}

export function trialSampleIssue(draft: Draft, datasets: readonly Dataset[]): string | null {
  if (draft.mode !== "trial") return null;
  const { min, max } = trialSampleBounds(draft, datasets);
  if (draft.trialCap === "" || !Number.isSafeInteger(draft.trialCap) || draft.trialCap < min)
    return `请输入至少 ${min} 条样本`;
  if (max !== null && draft.trialCap > max)
    return `每份最多 ${max} 条，不能超过所选数据集的样本数`;
  return null;
}
