import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { processPage, type ProcessEvent } from "../../api/process";
import { isActive, type Task } from "../../domain/task";

type Snapshot = { events: (ProcessEvent & { executionStatus?: string })[]; after: number; hasMore: boolean };
/** 按服务端游标增量拉取；切页和刷新读取持久记录，不重新执行 Agent。 */
export function useProcess(task: Task, round: number, site: string) {
  const client = useQueryClient();
  const key = ["process", task.id, round, site];
  const result = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Snapshot> => {
      const old = client.getQueryData<Snapshot>(key);
      const next = await processPage(task.id, old?.after ?? 0, round, site);
      return { events: [...(old?.events ?? []), ...(next.events ?? [])].map((e) => ({ ...e, executionStatus: next.states?.[e.origin] })), after: next.after, hasMore: next.hasMore };
    },
    refetchInterval: (query) => query.state.data?.hasMore ? 100 : isActive(task) ? 1500 : false,
  });
  const taskId = task.id;
  const status = task.status;
  useEffect(() => { void client.invalidateQueries({ queryKey: ["process", taskId] }); }, [client, taskId, status]);
  return result;
}
