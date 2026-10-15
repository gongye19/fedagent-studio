import { type ResourceSpace, endpointOf, isConfigured } from "../domain/resources";
import { hrefOf } from "../state/route";
import type { State } from "../state/store";
import { PageHead, PanelEmpty, Tag } from "./common";
import { ResourceScope } from "./resources/ResourceScope";
import { Panel } from "./console";
import { Icon } from "./icons";

function usedBy(state: State, endpointId: string): number {
  return state.tasks.filter((task) => [task.config.serverModel, ...task.members.map((member) => member.model)]
    .some((ref) => endpointOf(ref, state.endpoints)?.id === endpointId)).length;
}

/** 模型接口列表。新增和编辑都是独立页面，和参与方一样。 */
export default function ModelsPage({ state, space = "workspace" }: { state: State; space?: ResourceSpace }) {
  return (
    <>
      <PageHead
        title="LLM 接口"
        meta="提供模型推理能力，供平台内置流程与汇总步骤使用。"
        actions={<a className="button button--primary" href={hrefOf({ page: "newEndpoint" })}><Icon name="plus" />新增接口</a>}
      />
      <ResourceScope space={space} routeOf={(value) => ({ page: "models", space: value })} />
      <Panel flush>
        {!state.endpoints.some((e) => e.resourceSpace === space) ? <PanelEmpty>{space === "workspace" ? "尚未接入 LLM，可使用公用接口，或新增自己的接口。" : "暂无公用 LLM 接口。"}</PanelEmpty> : null}
        <div className="table-shell">
          <table className="table table--stack table--fixed">
            <thead>
              <tr>
                <th scope="col" style={{ width: "34%" }}>接口</th>
                <th scope="col" style={{ width: "22%" }}>模型</th>
                <th scope="col" className="numeric" style={{ width: "10%" }}>并发上限</th>
                <th scope="col" className="numeric" style={{ width: "14%" }}>单价（元 / 百万 token）</th>
                <th scope="col" className="numeric" style={{ width: "10%" }}>使用</th>
                <th scope="col" className="numeric" style={{ width: "10%" }}><span className="visually-hidden">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {state.endpoints.filter((e) => e.resourceSpace === space).map((endpoint) => {
                const used = usedBy(state, endpoint.id);
                return (
                  <tr key={endpoint.id}>
                    {/* 列表只写接口名称；地址、密钥这些细节在编辑页里看 */}
                    <th scope="row">
                      <span className="cell-title">
                        {endpoint.name}
                        {endpoint.kind === "fake" ? <Tag>测试用</Tag> : isConfigured(endpoint) ? null : <Tag tone="warning">待配置</Tag>}
                      </span>
                    </th>
                    {/* 每个接口选用一个模型，只列这一个 */}
                    <td data-label="模型" className="nowrap">{endpoint.models.length > 1 ? `${endpoint.models[0]} 等 ${endpoint.models.length} 个` : endpoint.models[0] ?? "—"}</td>
                    <td className="numeric" data-label="并发上限">{endpoint.concurrency}</td>
                    <td className="numeric" data-label="单价（元 / 百万 token）">{endpoint.price === null ? "—" : endpoint.price}</td>
                    <td className="numeric" data-label="使用">{used ? `${used} 个任务` : "—"}</td>
                    <td className="numeric cell-action">
                      {endpoint.kind === "fake" ? null : (
                        <a className="button button--secondary button--compact" href={hrefOf({ page: "editEndpoint", id: endpoint.id })} aria-label={`编辑“${endpoint.name}”`}>编辑</a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
