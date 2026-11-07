import { useEffect, useState } from "react";
import { hrefOf, type Route } from "../state/route";
import { type State } from "../state/store";
import { Icon, type IconName } from "../ui/icons";

type NavKey = "home" | "tasks" | "apps" | "algorithms" | "models" | "resources" | "agents";

function navKeyOf(route: Route): NavKey {
  switch (route.page) {
    case "resources":
      return route.kind === "models" ? "models" : route.kind === "agents" ? "agents" : "resources";
    case "agents":
      return "agents";
    case "tasks":
    case "newTask":
    case "task":
      return "tasks";
    case "apps":
    case "app":
      return "apps";
    case "participants":
    case "newParticipant":
    case "newDataset":
      return "resources";
    case "algorithms":
      return "algorithms";
    case "models":
    case "newEndpoint":
    case "editEndpoint":
      return "models";
    default:
      return "home";
  }
}

type NavItem = { key: NavKey; label: string; icon: IconName; route: Route };

/** 所有入口同级展示；手机只折叠整个导航，不再隐藏资源目录。 */
const NAV: readonly NavItem[] = [
  { key: "home", label: "首页", icon: "home", route: { page: "home" } },
  { key: "tasks", label: "联邦任务", icon: "tasks", route: { page: "tasks" } },
  { key: "apps", label: "应用", icon: "apps", route: { page: "apps" } },
  { key: "resources", label: "数据资源", icon: "resources", route: { page: "resources", space: "workspace" } },
  { key: "models", label: "LLM 接口", icon: "model", route: { page: "models" } },
  { key: "algorithms", label: "算法", icon: "algorithm", route: { page: "algorithms" } },
];

export function Sidebar({ route, state }: { route: Route; state: State | null }) {
  const active = navKeyOf(route);
  const running = state?.tasks.filter((task) => task.status === "running" || task.status === "queued").length ?? 0;
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const link = (item: NavItem) => (
    <a
      key={item.key}
      className={`nav-link${item.key === active ? " nav-link--active" : ""}`}
      href={hrefOf(item.route)}
      aria-current={item.key === active ? "page" : undefined}
      onClick={close}
    >
      <span className="nav-label">
        <Icon name={item.icon} />
        {item.label}
      </span>
      {item.key === "tasks" && running ? (
        <span className="nav-count" aria-label={`${running} 个运行中或排队中`}>
          {running}
        </span>
      ) : null}
    </a>
  );

  useEffect(() => {
    // 手机上展开的菜单不跟着页面钉住：一滚动或按 Esc 就收起。
    if (!open) return;
    const onScroll = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <aside className={`sidebar${open ? " sidebar--open" : ""}`} aria-label="侧栏">
      <div className="sidebar-top">
        <a className="wordmark" href={hrefOf({ page: "home" })} onClick={close} translate="no">
          FedAgent Studio
        </a>
        <button
          type="button"
          className="menu-button"
          aria-expanded={open}
          aria-controls="main-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "收起" : "菜单"}
        </button>
      </div>
      <nav className="side-nav" id="main-nav" aria-label="主导航">
        {NAV.map(link)}
      </nav>
    </aside>
  );
}
