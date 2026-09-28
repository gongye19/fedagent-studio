import { useEffect, useReducer, useState, type Dispatch } from "react";
import { loadState, saveState } from "./state/persistence";
import { hrefOf, useRoute, type Route } from "./state/route";
import { useSimulation } from "./state/simulation";
import { reducer, taskOf, type Action, type State } from "./state/store";
import AlgorithmsPage from "./ui/AlgorithmsPage";
import AppPage from "./ui/AppPage";
import AppsPage from "./ui/AppsPage";
import { NotFound, Tag } from "./ui/common";
import HomePage from "./ui/HomePage";
import ModelsPage from "./ui/ModelsPage";
import NewTaskPage from "./ui/NewTaskPage";
import ParticipantsPage from "./ui/ParticipantsPage";
import TaskPage from "./ui/TaskPage";
import TasksPage from "./ui/TasksPage";

type NavKey = "home" | "tasks" | "apps" | "participants" | "algorithms" | "models";

function navKeyOf(route: Route): NavKey {
  switch (route.page) {
    case "tasks":
    case "newTask":
    case "task":
      return "tasks";
    case "apps":
    case "app":
      return "apps";
    case "participants":
      return "participants";
    case "algorithms":
      return "algorithms";
    case "models":
      return "models";
    default:
      return "home";
  }
}

/** 与原平台一致：首页、任务、应用放在上面，参与方、算法、模型接口收在"基础管理"下。 */
const NAV: readonly { group: string | null; items: readonly { key: NavKey; label: string; route: Route }[] }[] = [
  {
    group: null,
    items: [
      { key: "home", label: "首页", route: { page: "home" } },
      { key: "tasks", label: "联邦任务", route: { page: "tasks" } },
      { key: "apps", label: "应用", route: { page: "apps" } },
    ],
  },
  {
    group: "基础管理",
    items: [
      { key: "participants", label: "参与方与数据", route: { page: "participants" } },
      { key: "algorithms", label: "算法", route: { page: "algorithms" } },
      { key: "models", label: "模型接口", route: { page: "models" } },
    ],
  },
];

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const route = useRoute();
  useSimulation(state, dispatch);
  useEffect(() => saveState(state), [state]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main" onClick={(event) => {
        event.preventDefault();
        document.getElementById("main")?.focus();
      }}>跳到主要内容</a>
      <Sidebar route={route} state={state} onReset={() => {
        if (window.confirm("重置后，新建的任务、参与方、接口和发布记录都会清除，回到初始演示数据。确定重置？")) dispatch({ type: "resetDemo" });
      }} />
      <main className="main" id="main" tabIndex={-1}>
        <div className="page">
          <Page state={state} dispatch={dispatch} route={route} />
        </div>
      </main>
    </div>
  );
}

function Page({ state, dispatch, route }: { state: State; dispatch: Dispatch<Action>; route: Route }) {
  switch (route.page) {
    case "tasks":
      return <TasksPage state={state} />;
    case "newTask":
      return <NewTaskPage state={state} dispatch={dispatch} scenario={route.scenario} />;
    case "task": {
      const task = taskOf(state, route.id);
      return task ? <TaskPage key={task.id} task={task} state={state} dispatch={dispatch} tab={route.tab} /> : <NotFound kind="任务" back={{ page: "tasks" }} backLabel="联邦任务" />;
    }
    case "apps":
      return <AppsPage state={state} />;
    case "app": {
      const item = state.published.find((entry) => entry.id === route.id);
      return item
        ? <AppPage key={item.id} item={item} task={taskOf(state, item.taskId)} state={state} tab={route.tab} />
        : <NotFound kind="应用" back={{ page: "apps" }} backLabel="应用列表" />;
    }
    case "participants":
      return <ParticipantsPage state={state} dispatch={dispatch} selectedId={route.id} />;
    case "algorithms":
      return <AlgorithmsPage />;
    case "models":
      return <ModelsPage state={state} dispatch={dispatch} />;
    default:
      return <HomePage state={state} />;
  }
}

function Sidebar({ route, state, onReset }: { route: Route; state: State; onReset: () => void }) {
  const active = navKeyOf(route);
  const running = state.tasks.filter((task) => task.status === "running").length;
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <aside className={`sidebar${open ? " sidebar--open" : ""}`}>
      <div className="sidebar-top">
        <a className="wordmark" href={hrefOf({ page: "home" })} onClick={close} translate="no">Federation Studio</a>
        {/* 品牌位置只放有用的状态：这是前端原型，数据都是示例。 */}
        <span className="env" title="任务运行、结果和应用都是示例数据，后端尚未接入">
          <Tag tone="warning"><span className="env-long">前端原型 · </span>示例数据</Tag>
        </span>
        <button type="button" className="menu-button" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen((value) => !value)}>
          {open ? "收起" : "菜单"}
        </button>
      </div>
      <nav className="side-nav" id="main-nav" aria-label="主导航">
        {NAV.map((group) => (
          <div key={group.group ?? "main"} className="nav-group">
            {group.group ? <p>{group.group}</p> : null}
            {group.items.map((item) => (
              <a
                key={item.key}
                className={`nav-link${item.key === active ? " nav-link--active" : ""}`}
                href={hrefOf(item.route)}
                aria-current={item.key === active ? "page" : undefined}
                onClick={close}
              >
                <span>{item.label}</span>
                {item.key === "tasks" && running ? <span className="nav-count" aria-label={`${running} 个运行中`}>{running}</span> : null}
              </a>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <button type="button" className="link-button" onClick={onReset}>重置演示数据</button>
      </div>
    </aside>
  );
}
