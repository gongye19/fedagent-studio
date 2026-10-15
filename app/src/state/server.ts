/**
 * 后端数据：用 TanStack Query 读取和缓存。有排队或运行中的任务时每 2 秒刷新一次任务，否则 15 秒。
 * 改动数据的操作（actions.ts）完成后让相关的查询失效，页面自动拿到最新数据。
 */
import { QueryClient, useQuery } from "@tanstack/react-query";
import { agentsApi } from "../api/agents";
import { api } from "../api/client";
import { isActive, toTask, type Task } from "../domain/task";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 1000 } },
});

export const keys = {
  meta: ["meta"],
  registry: ["registry"],
  participants: ["participants"],
  datasets: ["datasets"],
  endpoints: ["endpoints"],
  agents: ["agents"],
  tasks: ["tasks"],
  apps: ["apps"],
  messages: (taskId: string, round: number, site: string) => ["messages", taskId, round, site],
} as const;

export function useServerData(enabled: boolean) {
  const participants = useQuery({ queryKey: keys.participants, queryFn: api.participants, enabled, refetchInterval: 15_000 });
  const datasets = useQuery({ queryKey: keys.datasets, queryFn: api.datasets, enabled, refetchInterval: 30_000 });
  const endpoints = useQuery({ queryKey: keys.endpoints, queryFn: api.endpoints, enabled });
  const agents = useQuery({ queryKey: keys.agents, queryFn: agentsApi.list, enabled });
  const tasks = useQuery({
    queryKey: keys.tasks,
    queryFn: async (): Promise<Task[]> => (await api.tasks()).map(toTask),
    enabled,
    refetchInterval: (query) => (query.state.data?.some(isActive) ? 2_000 : 15_000),
  });
  const apps = useQuery({ queryKey: keys.apps, queryFn: api.apps, enabled });
  const all = [participants, datasets, endpoints, agents, tasks, apps];
  return {
    ready: all.every((item) => item.data !== undefined),
    error: all.find((item) => item.error)?.error ?? null,
    data: {
      participants: participants.data ?? [],
      datasets: datasets.data ?? [],
      endpoints: endpoints.data ?? [],
      agents: agents.data ?? [],
      tasks: tasks.data ?? [],
      published: apps.data ?? [],
    },
  };
}
