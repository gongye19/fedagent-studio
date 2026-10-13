import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type Dispatch, type FormEvent } from "react";
import { api, ApiError, getToken, setToken } from "./api/client";
import { clearFlash, useFlash } from "./state/flash";
import { loadDraft, saveDraft } from "./state/draft";
import { hrefOf, pageKeyOf, useRoute, type Route } from "./state/route";
import { keys, queryClient, useServerData } from "./state/server";
import { reducer, taskOf, withoutMissing, type Action, type State } from "./state/store";
import { ALGORITHMS, installRegistry, scenarioOf, type ScenarioId } from "./domain/catalog";
import AlgorithmPage from "./ui/AlgorithmPage";
import AlgorithmsPage from "./ui/AlgorithmsPage";
import AppPage from "./ui/AppPage";
import AppsPage from "./ui/AppsPage";
import { EmptyState, NotFound, PageHead, Toast } from "./ui/common";
import { Icon, type IconName } from "./ui/icons";
import EndpointPage from "./ui/EndpointPage";
import HomePage from "./ui/HomePage";
import ModelsPage from "./ui/ModelsPage";
import NewDatasetPage from "./ui/NewDatasetPage";
import NewParticipantPage from "./ui/NewParticipantPage";
import HorizontalTaskPage from "./ui/HorizontalTaskPage";
import ParticipantsPage from "./ui/ParticipantsPage";
import ResourcesPage from "./ui/ResourcesPage";
import TaskPage from "./ui/TaskPage";
import TasksPage from "./ui/TasksPage";
import { useContentMotion } from "./ui/hooks";

type NavKey = "home" | "tasks" | "apps" | "participants" | "algorithms" | "models" | "resources" | "publicResources";

function navKeyOf(route: Route): NavKey {
  switch (route.page) {
    case "resources":
      return route.space === "public" ? "publicResources" : "resources";
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
      return "participants";
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

/**
 * 一级导航：首页、联邦任务、应用、基础管理，四项同一级、同一个样式。
 * 基础管理是可以展开的一组，点开后才出现参与方与数据、算法、模型接口。
 */
const NAV: readonly NavItem[] = [
  { key: "home", label: "首页", icon: "home", route: { page: "home" } },
  { key: "tasks", label: "联邦任务", icon: "tasks", route: { page: "tasks" } },
  { key: "apps", label: "应用", icon: "apps", route: { page: "apps" } },
  { key: "resources", label: "我的资源", icon: "resources", route: { page: "resources", space: "workspace" } },
];

const MANAGE: readonly NavItem[] = [
  { key: "publicResources", label: "公用资源", icon: "resources", route: { page: "resources", space: "public" } },
  { key: "algorithms", label: "算法", icon: "algorithm", route: { page: "algorithms" } },
  { key: "models", label: "模型接口", icon: "model", route: { page: "models" } },
];

export default function App() {
  const route = useRoute();
  const pageKey = pageKeyOf(route);
  const pageMotion = useContentMotion(pageKey);
  const firstPage = useRef(true);
  const flash = useFlash(route);
  // 注册表（后端安装的场景、任务类型、算法）和数据同时取，都到了才渲染页面；需要访问令牌时先输入令牌。
  const registry = useQuery({
    queryKey: keys.registry,
    queryFn: async () => {
      const data = await api.registry();
      installRegistry(data);
      return data;
    },
    staleTime: Infinity,
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
  });
  // 不等注册表：数据不依赖它，同时发出能省一次往返（经 Tailscale 中继时每次约 0.3 秒）；没有令牌时不再轮询
  const unauthorized = registry.error instanceof ApiError && registry.error.status === 401;
  const server = useServerData(!unauthorized);
  const [draft, setDraft] = useState(loadDraft);
  const datasets = useRef(server.data.datasets);
  useEffect(() => {
    datasets.current = server.data.datasets;
  });
  const dispatch = useCallback((action: Action) => setDraft((previous) => reducer(previous, action, datasets.current)), []);
  useEffect(() => saveDraft(draft), [draft]);

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

  const error = registry.error ?? server.error;
  if (error instanceof ApiError && error.status === 401) return <TokenGate />;
  const state: State | null = registry.isSuccess && server.ready ? { ...server.data, draft: withoutMissing(draft, server.data.datasets) } : null;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main" onClick={(event) => {
        event.preventDefault();
        document.getElementById("main")?.focus();
      }}>跳到主要内容</a>
      <Sidebar route={route} state={state} />
      <main className="main" id="main" tabIndex={-1}>
        <div className="page" ref={pageMotion}>
          {flash ? (
            <Toast key={flash.id}
              action={flash.link ? <a className="text-link" href={hrefOf(flash.link.route)}>{flash.link.label}</a> : undefined}
              onDismiss={clearFlash}
            >
              {flash.text}
            </Toast>
          ) : null}
          {state ? <Page state={state} dispatch={dispatch} route={route} /> : error ? <Unavailable error={error} /> : <Loading />}
        </div>
      </main>
    </div>
  );
}

function Loading() {
  return <p className="page-loading" role="status">正在读取…</p>;
}

/** 连不上后端，或者后端返回了错误。 */
function Unavailable({ error }: { error: Error }) {
  return (
    <>
      <PageHead title="服务暂不可用" />
      <EmptyState
        title={error instanceof ApiError && error.status === 0 ? "连不上后端服务" : "读取数据失败"}
        action={<button type="button" className="button button--secondary" onClick={() => queryClient.invalidateQueries()}>重试</button>}
      >
        <p>{error.message}</p>
      </EmptyState>
    </>
  );
}

/** 部署设置了访问令牌：先输入令牌（保存在这个浏览器里）。 */
function TokenGate() {
  const [value, setValue] = useState("");
  const [failed, setFailed] = useState(Boolean(getToken()));
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    setToken(value.trim());
    setFailed(false);
    void queryClient.resetQueries();
  }
  return (
    <main className="token-gate" id="main">
      <form className="token-gate-card" onSubmit={submit}>
        <h1>FedAgent Studio</h1>
        <label className="field-label" htmlFor="access-token">访问令牌</label>
        <input id="access-token" name="access-token" type="password" autoComplete="current-password" value={value} onChange={(event) => setValue(event.target.value)} />
        {failed ? <p className="field-error" role="alert">令牌不对或已过期，请重新输入</p> : null}
        <button type="submit" className="button button--primary" disabled={!value.trim()}>进入</button>
      </form>
    </main>
  );
}

function Page({ state, dispatch, route }: { state: State; dispatch: Dispatch<Action>; route: Route }) {
  switch (route.page) {
    case "tasks":
      return <TasksPage state={state} />;
    case "newTask":
      // 每个场景有自己的任务配置页（场景不同，要配置的东西不同）；目前只有横向联邦。
      return !route.scenario || scenarioOf(route.scenario).status === "available"
        ? <HorizontalTaskPage state={state} dispatch={dispatch} initialScenario={route.scenario} />
        : <PlannedTaskConfig scenario={route.scenario} />;
    case "resources":
      return <ResourcesPage state={state} space={route.space} kind={route.kind} selectedId={route.id} />;
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
        : <NotFound kind="应用" back={{ page: "apps" }} backLabel="应用" />;
    }
    case "participants":
      return <ParticipantsPage state={state} selectedId={route.id} />;
    case "newParticipant":
      return <NewParticipantPage state={state} dispatch={dispatch} from={route.from} />;
    case "newDataset":
      return <NewDatasetPage key={route.participant ?? ""} state={state} dispatch={dispatch} participant={route.participant} from={route.from} />;
    case "algorithms": {
      if (!route.id) return <AlgorithmsPage />;
      const algorithm = ALGORITHMS.find((item) => item.id === route.id);
      return algorithm ? <AlgorithmPage algorithm={algorithm} /> : <NotFound kind="算法" back={{ page: "algorithms" }} backLabel="算法" />;
    }
    case "models":
      return <ModelsPage state={state} />;
    case "newEndpoint":
      return <EndpointPage state={state} from={route.from} />;
    case "editEndpoint":
      return <EndpointPage state={state} id={route.id} from={route.from} />;
    default:
      return <HomePage />;
  }
}

/** 还没有配置页的场景（算法规划中）：说明原因，回到任务列表。 */
function PlannedTaskConfig({ scenario }: { scenario: ScenarioId }) {
  const item = scenarioOf(scenario);
  return (
    <>
      <PageHead title={`新建${item.short}任务`} crumbs={[{ label: "联邦任务", route: { page: "tasks" } }]} />
      <EmptyState title="暂时不能新建" action={<a className="button button--secondary" href={hrefOf({ page: "tasks" })}>返回联邦任务</a>}>
        <p>{item.short}的算法还在规划中，接入后在这里配置这个场景的任务。</p>
      </EmptyState>
    </>
  );
}

function Sidebar({ route, state }: { route: Route; state: State | null }) {
  const active = navKeyOf(route);
  const running = state?.tasks.filter((task) => task.status === "running" || task.status === "queued").length ?? 0;
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  // 基础管理：在它下面的页面时默认展开，否则收起；用户点过就按用户的来，换到另一组页面时再回到默认。
  const inManage = MANAGE.some((item) => item.key === active);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const [wasInManage, setWasInManage] = useState(inManage);
  if (wasInManage !== inManage) {
    setWasInManage(inManage);
    setToggled(null);
  }
  const manageOpen = toggled ?? inManage;

  const link = (item: NavItem, sub = false) => (
    <a
      key={item.key}
      className={`nav-link${sub ? " nav-link--sub" : ""}${item.key === active ? " nav-link--active" : ""}`}
      href={hrefOf(item.route)}
      aria-current={item.key === active ? "page" : undefined}
      onClick={close}
    >
      <span className="nav-label"><Icon name={item.icon} />{item.label}</span>
      {item.key === "tasks" && running ? <span className="nav-count" aria-label={`${running} 个运行中或排队中`}>{running}</span> : null}
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
        <a className="wordmark" href={hrefOf({ page: "home" })} onClick={close} translate="no">FedAgent Studio</a>
        <button type="button" className="menu-button" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen((value) => !value)}>
          {open ? "收起" : "菜单"}
        </button>
      </div>
      <nav className="side-nav" id="main-nav" aria-label="主导航">
        {NAV.map((item) => link(item))}
        <button
          type="button"
          className={`nav-link nav-parent${inManage ? " nav-parent--current" : ""}`}
          aria-expanded={manageOpen}
          aria-controls="nav-manage"
          onClick={() => setToggled(!manageOpen)}
        >
          <span className="nav-label"><Icon name="manage" />基础管理</span>
          <Icon name="chevron" />
        </button>
        <div className={`nav-sub${manageOpen ? " nav-sub--open" : ""}`} id="nav-manage" inert={!manageOpen} aria-hidden={!manageOpen}>
          <div className="nav-sub-content">{MANAGE.map((item) => link(item, true))}</div>
        </div>
      </nav>
    </aside>
  );
}
