/**
 * 基于 hash 的页面路由。用 hash 是为了让静态部署和本地预览都不需要服务端路由配置。
 *
 * #/                          联邦数据
 * #/tasks                     联邦任务
 * #/tasks/new[/场景]           新建联邦任务，可带入场景选择
 * #/tasks/:id[/标签]           任务详情
 * #/results                   联邦成果
 * #/apps                      应用目录
 * #/apps/consultation         医疗问诊
 * #/apps/:id[/标签]            应用详情
 * #/participants[/场景[/:id]] 参与方与数据：按场景分块；带 id 时展开那一行（数据集 id，或参与方 id）
 * #/participants/new          新增参与方
 * #/datasets/new              新增数据集（?participant=参与方 id 时预先选好参与方）
 * #/algorithms[/:id]          算法：按场景分栏；带 id 时是这个算法的详情页
 * #/models                    模型接口
 * #/models/new                新增接口
 * #/models/:id/edit           编辑接口
 *
 * 新增、编辑页和 AWS 控制台一样是独立页面。从新建任务过来时地址带 ?from=new-task，保存或取消后回到新建任务。
 */
import { useEffect, useState } from "react";
import type { ScenarioId } from "../domain/catalog";
import { MEDICAL_RECORDS } from "../domain/consultation";
import type { ResourceSpace } from "../domain/resources";

export type ResourceKind = "data" | "models" | "agents";

/** 三种场景是平台内置的（后端核心里的规则），地址里只认这三个；注册表还没读到时也能解析地址。 */
const SCENARIO_IDS: readonly ScenarioId[] = ["horizontal", "vertical", "transfer"];

export const TASK_TABS = ["overview", "progress", "output", "config"] as const;
export type TaskTab = (typeof TASK_TABS)[number];

export const APP_TABS = ["try", "content", "integrate"] as const;
export type AppTab = (typeof APP_TABS)[number];

/** 从哪个流程进入的新增、编辑页；目前只有新建任务。 */
export type From = "newTask";

export type Route =
  | { page: "home" }
  | { page: "tasks" }
  | { page: "newTask"; scenario?: ScenarioId; application?: string; dataset?: string }
  | { page: "resources"; space?: ResourceSpace; kind?: ResourceKind; id?: string; upload?: boolean }
  | { page: "task"; id: string; tab?: TaskTab }
  | { page: "results" }
  | { page: "consultation"; packageId?: string }
  | { page: "apps" }
  | { page: "application"; taskType: string }
  | { page: "app"; id: string; tab?: AppTab }
  | { page: "participants"; scenario?: ScenarioId; id?: string }
  | { page: "newParticipant"; from?: From }
  | { page: "newDataset"; participant?: string; from?: From }
  | { page: "algorithms"; id?: string }
  | { page: "models"; space?: ResourceSpace }
  | { page: "agents"; space?: ResourceSpace }
  | { page: "newEndpoint"; from?: From }
  | { page: "editEndpoint"; id: string; from?: From };

export function applicationRoute(taskType: string): Route {
  return taskType === MEDICAL_RECORDS ? { page: "consultation" } : { page: "application", taskType };
}

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
      if (second === "new") {
        // 通用入口在配置页选择场景；旧场景直达链接仍可带入场景。
        const scenario = oneOf(SCENARIO_IDS, third);
        if (third && !scenario) return {page:"tasks"};
        const application = search.get("application") ?? undefined;
        const dataset = search.get("dataset") ?? undefined;
        return {...(scenario ? { page: "newTask" as const, scenario } : { page: "newTask" as const }), ...(application ? { application } : {}), ...(dataset ? { dataset } : {})};
      }
      return { page: "task", id: second, tab: oneOf(TASK_TABS, third) };
    case "results":
      return { page: "results" };
    case "consultation":
      return consultationRoute(search);
    case "applications":
      return second ? {page:"application", taskType:second} : {page:"apps"};
    case "apps":
    case "libraries": // 旧地址
      if (first === "apps" && second === "consultation") return consultationRoute(search);
      return second ? { page: "app", id: second, tab: oneOf(APP_TABS, third) } : { page: "apps" };
    case "participants": {
      if (second === "new") return withFrom({ page: "newParticipant" as const });
      const scenario = oneOf(SCENARIO_IDS, second);
      if (scenario) return third ? { page: "participants", scenario, id: third } : { page: "participants", scenario };
      // 旧地址 #/participants/:id：由页面按这个参与方的数据集决定打开哪个场景
      return second ? { page: "participants", id: second } : { page: "participants" };
    }
    case "resources": {
      const upload = search.get("upload") === "1" ? { upload: true } : {};
      if (second === "mine" || second === "public") {
        const id = path.split("/").filter(Boolean).map(decodeURIComponent)[3];
        return { page: "resources", space: second === "public" ? "public" : "workspace",
          kind: oneOf(["data", "models", "agents"] as const, third) ?? "data", id, ...upload };
      }
      return { page: "resources", id: second === "data" ? third : undefined, ...upload };
    }
    case "datasets": {
      // 数据集已并入"参与方与数据"，旧的列表地址回到那里
      if (second !== "new") return { page: "participants" };
      const participant = search.get("participant");
      return withFrom(participant ? { page: "newDataset" as const, participant } : { page: "newDataset" as const });
    }
    case "algorithms":
      return second ? { page: "algorithms", id: second } : { page: "algorithms" };
    case "agents":
      return second === "public" ? { page: "agents", space: "public" } : { page: "agents" };
    case "models":
      if (second === "new") return withFrom({ page: "newEndpoint" as const });
      if (second && third === "edit") return withFrom({ page: "editEndpoint" as const, id: second });
      return second === "public" ? { page: "models", space: "public" } : { page: "models" };
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
      return `#/tasks/new${route.scenario ? `/${route.scenario}` : ""}${query({application: route.application, dataset: route.dataset})}`;
    case "resources":
      return (route.kind === "models" || route.kind === "agents"
        ? `#/resources/${route.space === "public" ? "public" : "mine"}/${route.kind}`
        : "#/resources" + (route.id ? `/data/${part(route.id)}` : "")) + query({ upload: route.upload ? "1" : undefined });
    case "task":
      return `#/tasks/${part(route.id)}${route.tab ? `/${route.tab}` : ""}`;
    case "results":
      return "#/results";
    case "consultation":
      return `#/apps/consultation${query({ package: route.packageId })}`;
    case "apps":
      return "#/apps";
    case "application":
      return `#/applications/${part(route.taskType)}`;
    case "app":
      return `#/apps/${part(route.id)}${route.tab ? `/${route.tab}` : ""}`;
    case "participants":
      return `#/participants${route.scenario ? `/${route.scenario}` : ""}${route.id ? `/${part(route.id)}` : ""}`;
    case "newParticipant":
      return `#/participants/new${query({ from: fromValue(route.from) })}`;
    case "newDataset":
      return `#/datasets/new${query({ participant: route.participant, from: fromValue(route.from) })}`;
    case "algorithms":
      return route.id ? `#/algorithms/${part(route.id)}` : "#/algorithms";
    case "models":
      return `#/models${route.space === "public" ? "/public" : ""}`;
    case "agents":
      return `#/agents${route.space === "public" ? "/public" : ""}`;
    case "newEndpoint":
      return `#/models/new${query({ from: fromValue(route.from) })}`;
    case "editEndpoint":
      return `#/models/${part(route.id)}/edit${query({ from: fromValue(route.from) })}`;
    default:
      return "#/";
  }
}

function consultationRoute(search: URLSearchParams): Route {
  const packageId = search.get("package");
  return packageId ? { page: "consultation", packageId } : { page: "consultation" };
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
    case "algorithms":
      return route.id ? `algorithm:${route.id}` : route.page;
    default:
      return route.page;
  }
}

export function navigate(route: Route, options: { keepScroll?: boolean } = {}): void {
  window.location.hash = hrefOf(route);
  if (!options.keepScroll) window.scrollTo({ top: 0 });
}

/**
 * 新增、编辑页保存或取消后回到哪里：从新建任务来的回到那个场景的新建任务（scenario 是草稿里的场景），否则回列表。
 */
export function backTo(from: From | undefined, list: Route, scenario: ScenarioId | null): Route {
  if (from !== "newTask") return list;
  return { page: "newTask",scenario:scenario??undefined };
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
