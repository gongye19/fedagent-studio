import { nodeDelivery } from "../domain/inputs";
import { SELF_ORG, type Invitation } from "../domain/project";
import { hrefOf, navigate } from "../state/route";
import { eligibleDatasets, eligibleNodes, type Action, type State } from "../state/store";
import { StageMessage } from "./common";
import ConfigSummary from "./ConfigSummary";
import { formatDate } from "./format";
import NodeBinding from "./NodeBinding";

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** 收到的邀请：查看方案和对本机构的要求，选择节点和数据后接受并确认方案，或拒绝。 */
export default function InvitationPage({ invitation, state, dispatch }: { invitation: Invitation; state: State; dispatch: (action: Action) => void }) {
  const { plan } = invitation;
  const eligible = new Set(eligibleNodes(state, { plan, members: [] }).map((node) => node.id));
  const delivery = nodeDelivery("aliyun");

  function accept(node: string, datasetId: string) {
    const projectId = uid("prj");
    dispatch({ type: "acceptInvitation", invitationId: invitation.id, projectId, node, datasetId, newNodeId: uid("node"), createdAt: new Date().toISOString() });
    navigate({ page: "project", id: projectId });
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{invitation.projectName}</h1>
          <p className="page-meta">
            <span>{invitation.from} 邀请{SELF_ORG}加入</span>
            <span>{plan.scenario.label}</span>
            <span>收到于 {formatDate(invitation.receivedAt)}</span>
          </p>
        </div>
      </header>

      <div className="run-workspace">
        <section className="step-content" aria-labelledby="invite-plan-title">
          <header className="step-header">
            <h2 id="invite-plan-title">项目方案</h2>
            <span className="status">由 {invitation.from} 配置</span>
          </header>
          <div className="execution-workspace">
            <section className="data-contract" aria-labelledby="ask-title">
              <header className="section-head"><h3 id="ask-title">对本机构的要求</h3></header>
              <dl className="requirement-grid">
                <div><dt>本机构角色</dt><dd>{invitation.role}</dd></div>
                {plan.requirements.compute ? <div><dt>节点规格</dt><dd>≥ {plan.requirements.compute.label}（{plan.requirements.compute.hint}）</dd></div> : null}
                <div><dt>数据</dt><dd>{plan.requirements.dataType.label}</dd></div>
                {plan.requirements.network ? <div><dt>网络</dt><dd>{plan.requirements.network}</dd></div> : null}
                <div><dt>交付范围</dt><dd>{plan.deliveryScope.label}</dd></div>
              </dl>
            </section>
            <section aria-labelledby="others-title">
              <header className="section-head"><h3 id="others-title">已在项目中的机构</h3></header>
              <ul className="member-list">
                {invitation.others.map((other) => (
                  <li className="member" key={other.org}>
                    <div className="member-main">
                      <strong>{other.org}</strong>
                      {other.org === invitation.from ? <span className="badge">发起方</span> : null}
                      <span className="badge">{other.role}</span>
                      <span className="badge badge--auto">示例</span>
                      <span className="status status--complete">已确认方案</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            <ConfigSummary plan={plan} perspective="participant" />
          </div>
        </section>

        <aside className="run-panel invitation-panel" aria-labelledby="join-title">
          <header className="panel-head">
            <h2 id="join-title">加入项目</h2>
            <span className={`status${invitation.status === "accepted" ? " status--complete" : ""}`}>
              {invitation.status === "pending" ? "待回复" : invitation.status === "accepted" ? "已接受" : "已拒绝"}
            </span>
          </header>
          <div className="panel-body">
            {invitation.status === "pending" ? (
              <NodeBinding
                nodes={state.nodes}
                eligibleIds={eligible}
                requiredSpec={plan.requirements.compute?.id}
                newNode={plan.requirements.compute ? { label: `阿里云 · ${plan.requirements.compute.label}`, method: delivery.method } : undefined}
                datasets={eligibleDatasets(state, plan, invitation.role)}
                submitLabel="接受并确认方案"
                onSubmit={accept}
                secondary={(
                  <button type="button" className="button button--secondary" onClick={() => dispatch({ type: "declineInvitation", invitationId: invitation.id })}>
                    拒绝
                  </button>
                )}
              />
            ) : invitation.status === "accepted" && invitation.projectId ? (
              <>
                <StageMessage text="已接受邀请并确认方案。" />
                <a className="button button--secondary" href={hrefOf({ page: "project", id: invitation.projectId })}>查看项目</a>
              </>
            ) : (
              <StageMessage text="已拒绝这份邀请。" />
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
