import { QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { publish } from "./actions";
import { keys, queryClient } from "./server";
import type { Published } from "./store";

const app: Published = {
  id: "app-new", name: "新应用", taskId: "task-1", builtAfterRound: 2,
  publishedAt: "2026-10-05T16:00:00Z", scenario: "horizontal", taskType: "math-reasoning",
  algorithm: "fot", pluginVersion: "1.0.0", items: [],
};

afterEach(() => { queryClient.clear(); vi.restoreAllMocks(); });

it("发布后列表读取暂时落后，仍能立即打开新应用", async () => {
  vi.spyOn(api, "publish").mockResolvedValue(app);
  queryClient.setQueryData(keys.apps, []);
  const observer = new QueryObserver(queryClient, { queryKey: keys.apps, queryFn: async () => [], staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  try {
    const published = await publish("task-1", 2, "新应用");
    expect(queryClient.getQueryData<Published[]>(keys.apps)?.find((item) => item.id === published.id)).toEqual(app);
  } finally { unsubscribe(); observer.destroy(); }
});

it("发布后列表已有新应用，保留刷新得到的最新名称", async () => {
  vi.spyOn(api, "publish").mockResolvedValue(app);
  queryClient.setQueryData(keys.apps, [{ ...app, name: "更新后的名称" }]);
  await publish("task-1", 2, "新应用");
  expect(queryClient.getQueryData<Published[]>(keys.apps)).toEqual([{ ...app, name: "更新后的名称" }]);
});

it("动态 API 读取不使用浏览器 HTTP 缓存", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]"));
  expect(await api.apps()).toEqual([]);
  expect(fetch.mock.calls[0]?.[1]?.cache).toBe("no-store");
});
