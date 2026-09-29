import { useEffect, useReducer, useRef, useState, type Dispatch } from "react";
import { clearFlash, useFlash } from "./state/flash";
import { loadState, saveState } from "./state/persistence";
import { hrefOf, pageKeyOf, useRoute, type Route } from "./state/route";
import { useSimulation } from "./state/simulation";
import { reducer, taskOf, type Action, type State } from "./state/store";
import AlgorithmsPage from "./ui/AlgorithmsPage";
import AppPage from "./ui/AppPage";
import AppsPage from "./ui/AppsPage";
import { Confirm, NotFound, Notice, Tag } from "./ui/common";
import DatasetsPage from "./ui/DatasetsPage";
import EndpointPage from "./ui/EndpointPage";
import HomePage from "./ui/HomePage";
import ModelsPage from "./ui/ModelsPage";
import NewDatasetPage from "./ui/NewDatasetPage";
import NewParticipantPage from "./ui/NewParticipantPage";
import NewTaskPage from "./ui/NewTaskPage";
import ParticipantsPage from "./ui/ParticipantsPage";
import TaskPage from "./ui/TaskPage";
import TasksPage from "./ui/TasksPage";

type NavKey = "home" | "tasks" | "apps" | "participants" | "datasets" | "algorithms" | "models";

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
    case "newParticipant":
      return "participants";
    case "datasets":
    case "newDataset":
      return "datasets";
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

/** 与原平台一致：首页、任务、应用放在上面，参与方、数据集、算法、模型接口收在"基础管理"下。 */
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
      { key: "participants", label: "参与方", route: { page: "participants" } },
      { key: "datasets", label: "数据集", route: { page: "datasets" } },
      { key: "algorithms", label: "算法", route: { page: "algorithms" } },
      { key: "models", label: "模型接口", route: { page: "models" } },
    ],
  },
];

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const route = useRoute();
  const pageKey = pageKeyOf(route);
  const firstPage = useRef(true);
  const flash = useFlash(route);
  useSimulation(state, dispatch);
  useEffect(() => saveState(state), [state]);

  useEffect(() => {
    // 换页后焦点移到主内容，读屏软件从新页面开头读起；同一页里展开行、切换标签不算换页。
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [pageKey]);

  useEffect(() => {
    // 提示条只属于它显示的那一页，换到别的页就收起。
    if (!flash) clearFlash();
  }, [pageKey, flash]);

  const reset = () => dispatch({ type: "resetDemo" });
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main" onClick={(event) => {
        event.preventDefault();
        document.getElementById("main")?.focus();
      }}>跳到主要内容</a>
      <Sidebar route={route} state={state} onReset={reset} />
      <main className="main" id="main" tabIndex={-1}>
        <div className="page">
          {flash ? (
            <Notice
              action={flash.link ? <a className="text-link" href={hrefOf(flash.link.route)}>{flash.link.label}</a> : undefined}
              onDismiss={clearFlash}
            >
              {flash.text}
            </Notice>
          ) : null}
          <Page state={state} dispatch={dispatch} route={route} />
          {/* 窄屏时侧栏变成顶栏，"重置演示数据"放到页面底部，不和导航挤在一起 */}
          <div className="page-foot">
            <ResetDemo onReset={reset} />
          </div>
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
        ? <AppPage key={item.id} item={item} task={taskOf(state, item.taskId)} state={state} dispatch={dispatch} tab={route.tab} />
        : <NotFound kind="应用" back={{ page: "apps" }} backLabel="应用" />;
    }
    case "participants":
      return <ParticipantsPage state={state} dispatch={dispatch} selectedId={route.id} />;
    case "newParticipant":
      return <NewParticipantPage state={state} dispatch={dispatch} from={route.from} />;
    case "datasets":
      return <DatasetsPage state={state} dispatch={dispatch} selectedId={route.id} />;
    case "newDataset":
      return <NewDatasetPage key={route.participant ?? ""} state={state} dispatch={dispatch} participant={route.participant} from={route.from} />;
    case "algorithms":
      return <AlgorithmsPage selectedId={route.id} />;
    case "models":
      return <ModelsPage state={state} />;
    case "newEndpoint":
      return <EndpointPage state={state} dispatch={dispatch} from={route.from} />;
    case "editEndpoint":
      return <EndpointPage state={state} dispatch={dispatch} id={route.id} from={route.from} />;
    default:
      return <HomePage />;
  }
}

/** 重置演示数据：会清掉用户新建的内容，先在原地确认。 */
function ResetDemo({ onReset }: { onReset: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <Confirm title="重置演示数据？" confirmLabel="重置" onConfirm={() => { setConfirming(false); onReset(); }} onCancel={() => setConfirming(false)} className="confirm--compact">
        新建的任务、参与方、数据集、接口和发布记录都会清除。
      </Confirm>
    );
  }
  return <button type="button" className="link-button" onClick={() => setConfirming(true)}>重置演示数据</button>;
}

function Sidebar({ route, state, onReset }: { route: Route; state: State; onReset: () => void }) {
  const active = navKeyOf(route);
  const running = state.tasks.filter((task) => task.status === "running").length;
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

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
        <a className="wordmark" href={hrefOf({ page: "home" })} onClick={close} translate="no">FedAgent Studio</a>
        {/* 品牌位置只放有用的状态：这是前端原型，数据都是示例。 */}
        <span className="env" title="任务运行、结果和应用都是示例数据，后端尚未接入">
          {/* 宽屏时标签前面由样式补上"前端原型 · "，标签里只有文字 */}
          <Tag tone="warning">示例数据</Tag>
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
        <ResetDemo onReset={onReset} />
      </div>
    </aside>
  );
}
