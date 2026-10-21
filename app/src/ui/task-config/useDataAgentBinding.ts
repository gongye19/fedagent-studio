import { useState } from "react";
import { api } from "../../api/client";
import { keys, queryClient } from "../../state/server";

/** 绑定是资源的显式修改；失败不改选择，不自动触发付费测试。 */
export function useDataAgentBinding() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{
    datasetId: string;
    message: string;
  } | null>(null);
  async function save(datasetId: string, agentId: string | null) {
    if (pending) return false;
    setPending(datasetId);
    setError(null);
    try {
      await api.bindDataAgent(datasetId, agentId);
      await queryClient.invalidateQueries({ queryKey: keys.datasets });
      return true;
    } catch (failure) {
      setError({
        datasetId,
        message:
          failure instanceof Error ? failure.message : "绑定失败，请重试",
      });
      return false;
    } finally {
      setPending(null);
    }
  }
  return { pending, error, save };
}
