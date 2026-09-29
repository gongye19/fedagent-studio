/**
 * 基于 hash 的页面路由。用 hash 是为了让静态部署和本地预览都不需要服务端路由配置。
 *
 * #/                          首页
 * #/tasks                     联邦任务
 * #/tasks/new[/场景]           新建联邦任务
 * #/tasks/:id[/标签]           任务详情
 * #/apps                      应用（任务产出发布后的成果）
 * #/apps/:id[/标签]            应用详情
 * #/participants[/:id]        参与方
 * #/participants/new          新增参与方
 * #/datasets[/:id]            数据集
 * #/datasets/new              新增数据集（?participant=参与方 id 时预先选好参与方）
 * #/algorithms[/:id]          算法
 * #/models                    模型接口
 * #/models/new                新增接口
 * #/models/:id/edit           编辑接口
 *
 * 新增、编辑页和 AWS 控制台一样是独立页面。从新建任务过来时地址带 ?from=new-task，保存或取消后回到新建任务。
 */
import { useEffect, useState } from "react";
import { SCENARIOS, type ScenarioId } from "../domain/catalog";

export const TASK_TABS = ["overview", "progress", "output", "config"] as const;
export type TaskTab = (typeof TASK_TABS)[number];

export const APP_TABS = ["try", "content", "integrate"] as const;
export type AppTab = (typeof APP_TABS)[number];

/** 从哪个流程进入的新增、编辑页；目前只有新建任务。 */
export type From = "newTask";

export type Route =
  | { page: "home" }
  | { page: "tasks" }
  | { page: "newTask"; scenario?: ScenarioId }
  | { page: "task"; id: string; tab?: TaskTab }
  | { page: "apps" }
  | { page: "app"; id: string; tab?: AppTab }
  | { page: "participants"; id?: string }
  | { page: "newParticipant"; from?: From }
  | { page: "datasets"; id?: string }
  | { page: "newDataset"; participant?: string; from?: From }
  | { page: "algorithms"; id?: string }
  | { page: "models" }
  | { page: "newEndpoint"; from?: From }
  | { page: "editEndpoint"; id: string; from?: From };

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | undefined {
  return values.find((item) => item === value);
}

export function parseHash(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const search = new URLSearchParams(query);
  const from: From | undefined = search.get("from") === "new-task" ? "newTask" : undefined;
  const withFrom = <T extends object>(route: T): T & { from?: From } => (from ? { ...route, from } : route);
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
      if (second === "new") return withFrom({ page: "newParticipant" as const });
      return second ? { page: "participants", id: second } : { page: "participants" };
    case "datasets": {
      if (second !== "new") return second ? { page: "datasets", id: second } : { page: "datasets" };
      const participant = search.get("participant");
      return withFrom(participant ? { page: "newDataset" as const, participant } : { page: "newDataset" as const });
    }
    case "algorithms":
      return second ? { page: "algorithms", id: second } : { page: "algorithms" };
    case "models":
      if (second === "new") return withFrom({ page: "newEndpoint" as const });
      if (second && third === "edit") return withFrom({ page: "editEndpoint" as const, id: second });
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
    case "newParticipant":
      return `#/participants/new${query({ from: fromValue(route.from) })}`;
    case "datasets":
      return route.id ? `#/datasets/${part(route.id)}` : "#/datasets";
    case "newDataset":
      return `#/datasets/new${query({ participant: route.participant, from: fromValue(route.from) })}`;
    case "algorithms":
      return route.id ? `#/algorithms/${part(route.id)}` : "#/algorithms";
    case "models":
      return "#/models";
    case "newEndpoint":
      return `#/models/new${query({ from: fromValue(route.from) })}`;
    case "editEndpoint":
      return `#/models/${part(route.id)}/edit${query({ from: fromValue(route.from) })}`;
    default:
      return "#/";
  }
}

function fromValue(from: From | undefined): string | undefined {
  return from === "newTask" ? "new-task" : undefined;
}

/** 地址里的查询参数；没有值的项不写。 */
function query(values: Record<string, string | undefined>): string {
  const search = new URLSearchParams(Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
}

/**
 * 页面的标识：同一页里展开行、切换标签不算换页；换页时焦点移到主内容，提示条也只属于它显示的那一页。
 */
export function pageKeyOf(route: Route): string {
  switch (route.page) {
    case "task":
    case "app":
    case "editEndpoint":
      return `${route.page}:${route.id}`;
    default:
      return route.page;
  }
}

export function navigate(route: Route, options: { keepScroll?: boolean } = {}): void {
  window.location.hash = hrefOf(route);
  if (!options.keepScroll) window.scrollTo({ top: 0 });
}

/** 新增、编辑页保存或取消后回到哪里：从新建任务来的回新建任务，否则回列表。 */
export function backTo(from: From | undefined, list: Route): Route {
  return from === "newTask" ? { page: "newTask" } : list;
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
