/**
 * 基于 hash 的页面路由：工作台、新建项目、项目详情、邀请详情。
 * 用 hash 是为了让静态部署和本地预览都不需要服务端路由配置。
 */
import { useEffect, useState } from "react";

export type Route =
  | { page: "workbench" }
  | { page: "new" }
  | { page: "project"; id: string }
  | { page: "invitation"; id: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "");
  const [, first, second] = path.split("/");
  if (first === "new") return { page: "new" };
  if (first === "projects" && second) return { page: "project", id: decodeURIComponent(second) };
  if (first === "invites" && second) return { page: "invitation", id: decodeURIComponent(second) };
  return { page: "workbench" };
}

export function hrefOf(route: Route): string {
  switch (route.page) {
    case "new":
      return "#/new";
    case "project":
      return `#/projects/${encodeURIComponent(route.id)}`;
    case "invitation":
      return `#/invites/${encodeURIComponent(route.id)}`;
    default:
      return "#/";
  }
}

export function navigate(route: Route): void {
  window.location.hash = hrefOf(route);
  window.scrollTo({ top: 0 });
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
