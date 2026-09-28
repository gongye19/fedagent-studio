import { useEffect, useReducer, useState, type Dispatch } from "react";
import { loadState, saveState } from "./state/persistence";
import { hrefOf, useRoute, type Route } from "./state/route";
import { useSimulation } from "./state/simulation";
import { reducer, taskOf, type Action, type State } from "./state/store";
import { NotFound } from "./ui/common";
import LibrariesPage from "./ui/LibrariesPage";
import LibraryPage from "./ui/LibraryPage";
import ModelsPage from "./ui/ModelsPage";
import NewTaskPage from "./ui/NewTaskPage";
import ParticipantsPage from "./ui/ParticipantsPage";
import TaskPage from "./ui/TaskPage";
import TasksPage from "./ui/TasksPage";

type NavKey = "tasks" | "libraries" | "participants" | "models";

function navKeyOf(route: Route): NavKey {
  switch (route.page) {
    case "libraries":
    case "library":
      return "libraries";
    case "participants":
      return "participants";
    case "models":
      return "models";
    default:
      return "tasks";
  }
}

const NAV: readonly { group: string; items: readonly { key: NavKey; label: string; route: Route }[] }[] = [
  {
    group: "工作区",
    items: [
      { key: "tasks", label: "联邦任务", route: { page: "tasks" } },
      { key: "libraries", label: "洞见库", route: { page: "libraries" } },
    ],
  },
  {
    group: "资源",
    items: [
      { key: "participants", label: "参与方与数据", route: { page: "participants" } },
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
    case "newTask":
      return <NewTaskPage state={state} dispatch={dispatch} scenario={route.scenario} />;
    case "task": {
      const task = taskOf(state, route.id);
      return task ? <TaskPage key={task.id} task={task} state={state} dispatch={dispatch} tab={route.tab} /> : <NotFound kind="任务" back={{ page: "tasks" }} />;
    }
    case "libraries":
      return <LibrariesPage state={state} />;
    case "library": {
      const item = state.published.find((entry) => entry.id === route.id);
      return item
        ? <LibraryPage key={item.id} item={item} task={taskOf(state, item.taskId)} state={state} dispatch={dispatch} tab={route.tab} />
        : <NotFound kind="洞见库" back={{ page: "libraries" }} />;
    }
    case "participants":
      return <ParticipantsPage state={state} dispatch={dispatch} selectedId={route.id} />;
    case "models":
      return <ModelsPage state={state} dispatch={dispatch} />;
    default:
      return <TasksPage state={state} />;
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
        <a className="wordmark" href={hrefOf({ page: "tasks" })} onClick={close}>
          <strong>Federation Studio</strong>
          <small>联邦 Agent 平台</small>
        </a>
        <button type="button" className="menu-button" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen((value) => !value)}>
          {open ? "收起" : "菜单"}
        </button>
      </div>
      <nav className="side-nav" id="main-nav" aria-label="主导航">
        {NAV.map((group) => (
          <div key={group.group} className="nav-group">
            <p>{group.group}</p>
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
        <span className="environment" title="任务运行、结果和洞见库都是示例数据，后端尚未接入">前端原型 · 示例数据</span>
        <button type="button" className="link-button" onClick={onReset}>重置演示数据</button>
      </div>
    </aside>
  );
}
