/**
 * 基于 hash 的页面路由。用 hash 是为了让静态部署和本地预览都不需要服务端路由配置。
 *
 * #/（或 #/tasks）              联邦任务（首页）
 * #/tasks/new[/场景]           新建联邦任务
 * #/tasks/:id[/标签]           任务详情
 * #/libraries                 洞见库
 * #/libraries/:id[/标签]       洞见库详情
 * #/participants[/:id]        参与方与数据
 * #/models                    模型接口
 */
import { useEffect, useState } from "react";
import { SCENARIOS, type ScenarioId } from "../domain/catalog";

export const TASK_TABS = ["results", "progress", "library", "config"] as const;
export type TaskTab = (typeof TASK_TABS)[number];

export const LIBRARY_TABS = ["insights", "try", "integrate"] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];

export type Route =
  | { page: "tasks" }
  | { page: "newTask"; scenario?: ScenarioId }
  | { page: "task"; id: string; tab?: TaskTab }
  | { page: "libraries" }
  | { page: "library"; id: string; tab?: LibraryTab }
  | { page: "participants"; id?: string }
  | { page: "models" };

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | undefined {
  return values.find((item) => item === value);
}

export function parseHash(hash: string): Route {
  const [path] = hash.replace(/^#/, "").split("?");
  const [first, second, third] = path.split("/").filter(Boolean).map(decodeURIComponent);
  switch (first) {
    case "tasks":
      if (!second) return { page: "tasks" };
      if (second === "new") return { page: "newTask", scenario: oneOf(SCENARIOS.map((item) => item.id), third) };
      return { page: "task", id: second, tab: oneOf(TASK_TABS, third) };
    case "libraries":
      return second ? { page: "library", id: second, tab: oneOf(LIBRARY_TABS, third) } : { page: "libraries" };
    case "participants":
      return { page: "participants", id: second };
    case "models":
      return { page: "models" };
    default:
      return { page: "tasks" };
  }
}

export function hrefOf(route: Route): string {
  const part = (value: string) => encodeURIComponent(value);
  switch (route.page) {
    case "newTask":
      return route.scenario ? `#/tasks/new/${route.scenario}` : "#/tasks/new";
    case "task":
      return `#/tasks/${part(route.id)}${route.tab ? `/${route.tab}` : ""}`;
    case "libraries":
      return "#/libraries";
    case "library":
      return `#/libraries/${part(route.id)}${route.tab ? `/${route.tab}` : ""}`;
    case "participants":
      return route.id ? `#/participants/${part(route.id)}` : "#/participants";
    case "models":
      return "#/models";
    default:
      return "#/";
  }
}

export function navigate(route: Route, options: { keepScroll?: boolean } = {}): void {
  window.location.hash = hrefOf(route);
  if (!options.keepScroll) window.scrollTo({ top: 0 });
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
