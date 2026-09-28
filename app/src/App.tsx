import { useEffect, useReducer } from "react";
import { SELF_ORG } from "./domain/project";
import { loadState, saveState } from "./state/persistence";
import { hrefOf, useRoute, type Route } from "./state/route";
import { useSimulation } from "./state/simulation";
import { projectOf, reducer } from "./state/store";
import InvitationPage from "./ui/InvitationPage";
import NewProjectPage from "./ui/NewProjectPage";
import ProjectPage, { ProjectNotFound } from "./ui/ProjectPage";
import WorkbenchPage from "./ui/WorkbenchPage";

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const route = useRoute();
  useSimulation(state, dispatch);
  useEffect(() => saveState(state), [state]);

  function page() {
    switch (route.page) {
      case "new":
        return <NewProjectPage draft={state.draft} dispatch={dispatch} />;
      case "project": {
        const project = projectOf(state, route.id);
        return project ? <ProjectPage key={project.id} project={project} state={state} dispatch={dispatch} /> : <ProjectNotFound />;
      }
      case "invitation": {
        const invitation = state.invitations.find((item) => item.id === route.id);
        return invitation ? <InvitationPage invitation={invitation} state={state} dispatch={dispatch} /> : <ProjectNotFound />;
      }
      default:
        return <WorkbenchPage state={state} dispatch={dispatch} />;
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main" onClick={(event) => {
        event.preventDefault();
        document.getElementById("main")?.focus();
      }}>跳到主要内容</a>
      <header className="navbar">
        <div className="nav-inner">
          <a className="wordmark" href={hrefOf({ page: "workbench" })} aria-label="Federation Studio 工作台">
            <span aria-hidden="true">F</span>
            <strong>Federation Studio</strong>
          </a>
          <nav className="nav-links" aria-label="主导航">
            <NavLink route={route} target={{ page: "workbench" }} label="工作台" />
            <NavLink route={route} target={{ page: "new" }} label="新建项目" />
          </nav>
          <div className="nav-end">
            <span className="environment" title="所有执行都是前端模拟，后端未接入">模拟环境</span>
            <span className="org-chip" title="当前登录的机构">{SELF_ORG}</span>
          </div>
        </div>
      </header>

      <main className="page" id="main" tabIndex={-1}>
        {page()}
      </main>
    </div>
  );
}

function NavLink({ route, target, label }: { route: Route; target: Route; label: string }) {
  const active = route.page === target.page || (target.page === "workbench" && (route.page === "project" || route.page === "invitation"));
  return (
    <a className={`nav-link${active ? " nav-link--active" : ""}`} href={hrefOf(target)} aria-current={active ? "page" : undefined}>
      {label}
    </a>
  );
}
