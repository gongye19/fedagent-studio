import { PROJECT_STATUS_LABEL, projectStatus, readiness, SELF_ORG } from "../domain/project";
import { computeOf, dataTypeOf, deploymentOf } from "../domain/taxonomy";
import { hrefOf } from "../state/route";
import type { Action, State } from "../state/store";
import { formatDate } from "./format";
import { PROJECT_TONE } from "./progress";

const NODE_STATUS = { online: "在线", offline: "离线", provisioning: "交付中" } as const;
const NODE_TONE = { online: "complete", offline: "", provisioning: "running" } as const;

/** 工作台：本机构的项目、收到的邀请、节点和登记的数据。 */
export default function WorkbenchPage({ state, dispatch }: { state: State; dispatch: (action: Action) => void }) {
  const pending = state.invitations.filter((invitation) => invitation.status === "pending");

  return (
    <>
      <header className="page-head">
        <div>
          <h1>工作台</h1>
          <p className="page-lede">{SELF_ORG}发起或参加的联邦项目。数据始终留在各方节点，平台只登记描述信息。</p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              if (window.confirm("重置后，所有项目、节点和邀请恢复为初始的演示数据。确定重置吗？")) dispatch({ type: "resetDemo" });
            }}
          >
            重置演示数据
          </button>
          <a className="button button--primary" href={hrefOf({ page: "new" })}>新建联邦项目</a>
        </div>
      </header>

      <div className="workbench">
        <div className="workbench-main">
          <section className="panel" aria-labelledby="projects-title">
            <header className="panel-head">
              <h2 id="projects-title">我的项目</h2>
              <span className="panel-count">{state.projects.length}</span>
            </header>
            {state.projects.length ? (
              <div className="table-wrap table-wrap--flush">
                <table className="data-table">
                  <thead>
                    <tr><th>项目</th><th>角色</th><th>参与方</th><th>状态</th><th>创建时间</th></tr>
                  </thead>
                  <tbody>
                    {state.projects.map((project) => {
                      const status = projectStatus(project);
                      const progress = readiness(project);
                      const count = project.run ? `${project.run.participants.length} 方参加` : `${progress.confirmed} / ${progress.min} 方`;
                      return (
                        <tr key={project.id}>
                          <td>
                            <a className="table-link" href={hrefOf({ page: "project", id: project.id })}>{project.name}</a>
                            <small>{project.plan.scenario.label} · {project.plan.model.label}</small>
                          </td>
                          <td>{project.role === "initiator" ? "发起方" : `参与方 · ${project.initiatorOrg}发起`}</td>
                          <td className="numeric">{count}</td>
                          <td><span className={`status${PROJECT_TONE[status] ? ` status--${PROJECT_TONE[status]}` : ""}`}>{PROJECT_STATUS_LABEL[status]}</span></td>
                          <td className="numeric">{formatDate(project.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="panel-empty">还没有项目。新建一个联邦项目，选好配置后邀请合作方加入。</p>
            )}
          </section>

          <section className="panel" aria-labelledby="invites-title">
            <header className="panel-head">
              <h2 id="invites-title">收到的邀请</h2>
              <span className="panel-count">{pending.length}</span>
            </header>
            {state.invitations.length ? (
              <ul className="invite-list">
                {state.invitations.map((invitation) => (
                  <li key={invitation.id}>
                    <div>
                      <strong>{invitation.from} 邀请{SELF_ORG}加入「{invitation.projectName}」</strong>
                      <small>
                        {invitation.plan.scenario.label} · 本机构角色：{invitation.role} · 需要：
                        {invitation.plan.requirements.dataType.label}
                        {invitation.plan.requirements.compute ? ` · 节点 ≥ ${invitation.plan.requirements.compute.label}` : ""}
                      </small>
                    </div>
                    {invitation.status === "pending" ? (
                      <a className="button button--secondary" href={hrefOf({ page: "invitation", id: invitation.id })}>查看邀请</a>
                    ) : invitation.status === "accepted" && invitation.projectId ? (
                      <a className="button button--secondary" href={hrefOf({ page: "project", id: invitation.projectId })}>已加入 · 查看项目</a>
                    ) : (
                      <span className="status">已拒绝</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panel-empty">暂无邀请。</p>
            )}
          </section>
        </div>

        <aside className="workbench-aside">
          <section className="panel" aria-labelledby="nodes-title">
            <header className="panel-head">
              <h2 id="nodes-title">我的节点</h2>
              <span className="panel-count">{state.nodes.length}</span>
            </header>
            <ul className="resource-list">
              {state.nodes.map((node) => (
                <li key={node.id}>
                  <div>
                    <strong>{node.name}</strong>
                    <small>{deploymentOf(node.location)?.label} · {computeOf(node.spec)?.label}（{computeOf(node.spec)?.hint}）</small>
                  </div>
                  <span className={`status${NODE_TONE[node.status] ? ` status--${NODE_TONE[node.status]}` : ""}`}>{NODE_STATUS[node.status]}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel" aria-labelledby="data-title">
            <header className="panel-head">
              <h2 id="data-title">我的数据</h2>
              <span className="panel-count">{state.datasets.length}</span>
            </header>
            <ul className="resource-list">
              {state.datasets.map((dataset) => (
                <li key={dataset.id}>
                  <div>
                    <strong>{dataset.name}</strong>
                    <small>{dataTypeOf(dataset.type)?.label} · {dataset.detail}</small>
                  </div>
                </li>
              ))}
            </ul>
            <p className="panel-note">只登记描述信息，数据不离开节点。</p>
          </section>
        </aside>
      </div>
    </>
  );
}
