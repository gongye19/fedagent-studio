/**
 * 基于 hash 的页面路由。用 hash 是为了让静态部署和本地预览都不需要服务端路由配置。
 *
 * #/                          首页
 * #/tasks                     联邦任务
 * #/tasks/new[/场景]           新建联邦任务
 * #/tasks/:id[/标签]           任务详情
 * #/apps                      应用（任务产出发布后的成果）
 * #/apps/:id[/标签]            应用详情
 * #/participants[/:id]        参与方与数据
 * #/algorithms                算法
 * #/models                    模型接口
 */
import { useEffect, useState } from "react";
import { SCENARIOS, type ScenarioId } from "../domain/catalog";

export const TASK_TABS = ["overview", "progress", "output", "config"] as const;
export type TaskTab = (typeof TASK_TABS)[number];

export const APP_TABS = ["try", "content", "integrate"] as const;
export type AppTab = (typeof APP_TABS)[number];

export type Route =
  | { page: "home" }
  | { page: "tasks" }
  | { page: "newTask"; scenario?: ScenarioId }
  | { page: "task"; id: string; tab?: TaskTab }
  | { page: "apps" }
  | { page: "app"; id: string; tab?: AppTab }
  | { page: "participants"; id?: string }
  | { page: "algorithms" }
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
    case "apps":
    case "libraries": // 旧地址
      return second ? { page: "app", id: second, tab: oneOf(APP_TABS, third) } : { page: "apps" };
    case "participants":
      return { page: "participants", id: second };
    case "algorithms":
      return { page: "algorithms" };
    case "models":
      return { page: "models" };
    default:
      return { page: "home" };
  }
}

export function hrefOf(route: Route): string {
  const part = (value: string) => encodeURIComponent(value);
  switch (route.page) {
    case "tasks":
      return "#/tasks";
    case "newTask":
      return route.scenario ? `#/tasks/new/${route.scenario}` : "#/tasks/new";
    case "task":
      return `#/tasks/${part(route.id)}${route.tab ? `/${route.tab}` : ""}`;
    case "apps":
      return "#/apps";
    case "app":
      return `#/apps/${part(route.id)}${route.tab ? `/${route.tab}` : ""}`;
    case "participants":
      return route.id ? `#/participants/${part(route.id)}` : "#/participants";
    case "algorithms":
      return "#/algorithms";
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
