import { DEFAULT_ENDPOINT_ID, endpointOf, isConfigured } from "../domain/resources";
import { hrefOf } from "../state/route";
import type { State } from "../state/store";
import { Meta, PageHead, Tag } from "./common";
import { Panel } from "./console";
import { Icon } from "./icons";

function usedBy(state: State, endpointId: string): number {
  return state.tasks.filter((task) => [task.config.serverModel, ...task.members.map((member) => member.model)]
    .some((ref) => endpointOf(ref, state.endpoints)?.id === endpointId)).length;
}

/** 模型接口列表。新增和编辑都是独立页面，和参与方一样。 */
export default function ModelsPage({ state }: { state: State }) {
  return (
    <>
      <PageHead
        title="模型接口"
        meta="平台托管的参与方和服务端通过这些接口调用模型；本地参与方用自己的模型。"
        actions={<a className="button button--primary" href={hrefOf({ page: "newEndpoint" })}><Icon name="plus" />新增接口</a>}
      />
      <Panel flush>
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
              {state.endpoints.map((endpoint) => {
                const used = usedBy(state, endpoint.id);
                const fallback = endpoint.id === DEFAULT_ENDPOINT_ID;
                return (
                  <tr key={endpoint.id}>
                    <th scope="row">
                      <span className="cell-title">
                        {endpoint.name}
                        {endpoint.kind === "fake" ? <Tag>测试用</Tag> : isConfigured(endpoint) ? null : <Tag tone="warning">待配置</Tag>}
                      </span>
                      {endpoint.baseUrl || fallback || endpoint.kind === "fake" ? (
                        <small>
                          <Meta parts={[
                            endpoint.baseUrl ? <code key="url">{endpoint.baseUrl}</code> : null,
                            fallback ? "未指定模型的调用都走这里" : null,
                            endpoint.kind === "fake" ? "不调用真实模型，只用来跑通流程" : null,
                            endpoint.hasKey ? "已保存密钥" : null,
                          ]} />
                        </small>
                      ) : null}
                    </th>
                    <td data-label="模型">{endpoint.models.length ? endpoint.models.join("、") : "—"}</td>
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
