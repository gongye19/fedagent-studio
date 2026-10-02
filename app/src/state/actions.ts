/**
 * 改动后端数据的操作：调用 API，完成后让相关的查询失效。页面等它们返回再跳转、显示结果；失败时抛出 ApiError（带后端写明的原因）。
 */
import { api, type TaskConfigIn } from "../api/client";
import { activeOverrides, joinable, toConfig, type Draft } from "../domain/config";
import type { Dataset, Participant } from "../domain/resources";
import { toTask, type Task } from "../domain/task";
import { keys, queryClient } from "./server";

function refresh(...queries: readonly (readonly unknown[])[]): Promise<void> {
  return Promise.all(queries.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(() => undefined);
}

/** 草稿 → 创建任务的请求：只带上真正能参加的参与方（数据集还在、场景和任务类型一致、持有方在线）。 */
export function taskRequest(draft: Draft, name: string, datasets: readonly Dataset[], participants: readonly Participant[]): TaskConfigIn | null {
  const config = toConfig({ ...draft, participants: joinable(draft, datasets, participants) });
  if (!config) return null;
  return { ...config, name, clientOverrides: activeOverrides(config) };
}

export async function createTask(body: TaskConfigIn): Promise<Task> {
  const task = toTask(await api.createTask(body));
  await refresh(keys.tasks);
  return task;
}

export async function controlTask(id: string, action: "pause" | "resume" | "cancel"): Promise<void> {
  await api.controlTask(id, action);
  await refresh(keys.tasks);
}

export async function publish(taskId: string, builtAfterRound: number, name: string) {
  const app = await api.publish({ taskId, builtAfterRound, name });
  await refresh(keys.apps);
  return app;
}

export async function renameApp(id: string, name: string): Promise<void> {
  await api.renameApp(id, name);
  await refresh(keys.apps);
}

export async function withdrawApp(id: string): Promise<void> {
  await api.withdrawApp(id);
  await refresh(keys.apps);
}

export async function createParticipant(form: FormData) {
  const participant = await api.createParticipant(form);
  await refresh(keys.participants, keys.datasets);
  return participant;
}

export async function createDataset(form: FormData) {
  const dataset = await api.createDataset(form);
  await refresh(keys.datasets);
  return dataset;
}

export async function deleteDataset(id: string): Promise<void> {
  await api.deleteDataset(id);
  await refresh(keys.datasets);
}

export async function deleteParticipant(id: string): Promise<void> {
  await api.deleteParticipant(id);
  await refresh(keys.participants, keys.datasets);
}

export async function saveEndpoint(id: string | null, body: Parameters<typeof api.createEndpoint>[0]) {
  const endpoint = id ? await api.updateEndpoint(id, body) : await api.createEndpoint(body);
  await refresh(keys.endpoints);
  return endpoint;
}

export async function deleteEndpoint(id: string): Promise<void> {
  await api.deleteEndpoint(id);
  await refresh(keys.endpoints);
}
