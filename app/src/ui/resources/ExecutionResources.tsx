import { ALGORITHMS, TASK_TYPES } from "../../domain/catalog";
import { PARTICIPANT_STATUS } from "../../domain/resources";
import type { State } from "../../state/store";
import { Collapsible, Facts, PanelEmpty } from "../common";
import { Panel } from "../console";
import { LocalConnect } from "../ParticipantsPage";
import type { Participant } from "../../domain/resources";
import type { Algorithm } from "../../domain/catalog";

export function ExecutionResources({
  state,
  own,
  agents,
  flows,
}: {
  state: State;
  own: boolean;
  agents: Participant[];
  flows: Algorithm[];
}) {
  return own ? (
    <Panel title="本地执行环境" extra={`${agents.length} 个`}>
      {agents.length ? (
        <div className="panel-stack">
          {agents.map((p) => (
            <Collapsible key={p.id} title={p.name} sub={PARTICIPANT_STATUS[p.status]}>
              <Facts
                items={[
                  [
                    "已安装算法",
                    Object.entries(p.clientPlugins)
                      .map(([id, version]) => `${ALGORITHMS.find((a) => a.id === id)?.name ?? id} ${version}`)
                      .join("、") || "等待客户端上报",
                  ],
                ]}
              />
              <LocalConnect
                participantId={p.id}
                datasetIds={state.datasets.filter((d) => d.participantId === p.id).map((d) => d.id)}
              />
            </Collapsible>
          ))}
        </div>
      ) : (
        <PanelEmpty>接入数据时选择“本地客户端”，即可登记自己的执行环境。自有 Agent 服务接口尚未开放。</PanelEmpty>
      )}
    </Panel>
  ) : (
    <Panel title="平台执行流程" extra={`${flows.length} 个`} flush>
      {flows.length ? (
        <div className="table-shell">
          <table className="table table--stack">
            <thead>
              <tr>
                <th scope="col">执行流程</th>
                <th scope="col">适用任务</th>
                <th scope="col">使用方式</th>
              </tr>
            </thead>
            <tbody>
              {flows.map((a) => (
                <tr key={a.id}>
                  <th scope="row">{a.requirements.executionLabel}</th>
                  <td data-label="适用任务">{a.accepts.map((t) => TASK_TYPES[t]?.label ?? t).join("、")}</td>
                  <td data-label="使用方式">选择对应算法，由平台或已安装插件的本地客户端执行</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <PanelEmpty>没有匹配的执行流程。</PanelEmpty>
      )}
    </Panel>
  );
}
