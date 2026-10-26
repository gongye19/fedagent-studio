import {
  inResourceScope,
  type ResourceSpace,
  endpointOf,
  isConfigured,
} from "../domain/resources";
import { hrefOf } from "../state/route";
import type { State } from "../state/store";
import { PageHead, Tag } from "./common";
import { SharingButton } from "./resources/SharingButton";
import { ResourceScope } from "./resources/ResourceScope";
import { ResourceTable } from "./resources/ResourceTable";
import { Icon } from "./icons";

function usedBy(state: State, endpointId: string): number {
  return state.tasks.filter((task) =>
    [
      task.config.serverModel,
      ...task.members.map((member) => member.model),
    ].some((ref) => endpointOf(ref, state.endpoints)?.id === endpointId),
  ).length;
}

/** 模型接口列表。新增和编辑都是独立页面，和参与方一样。 */
export default function ModelsPage({
  state,
  space = "workspace",
}: {
  state: State;
  space?: ResourceSpace;
}) {
  return (
    <>
      <PageHead
        title="LLM 接口"
        meta="提供模型推理能力，供平台内置流程与汇总步骤使用。"
        actions={space === "workspace" ? (
          <a
            className="button button--primary"
            href={hrefOf({ page: "newEndpoint" })}
          >
            <Icon name="plus" />
            新增接口
          </a>
        ) : undefined}
      />
      <ResourceScope
        space={space}
        routeOf={(value) => ({ page: "models", space: value })}
      />
      <ResourceTable label="LLM 接口列表" columns={[
        {label: "接口名称", width: "30%"}, {label: "模型", width: "20%"},
        {label: "并发上限", className: "numeric", width: "10%"},
        {label: "单价（元 / 百万 token）", className: "numeric", width: "18%"},
        {label: "使用", className: "numeric", width: "10%"}, {label: "操作", className: "numeric"},
      ]} empty={!state.endpoints.some((e) => inResourceScope(e, space))}
        emptyContent={space === "workspace"
          ? "尚未接入 LLM，可使用共享接口，或新增自己的接口。"
          : "暂无共享 LLM 接口。"}>
        {state.endpoints
          .filter((e) => inResourceScope(e, space))
          .map((endpoint) => {
            const used = usedBy(state, endpoint.id);
            return (
              <tr key={endpoint.id}>
                {/* 列表只写接口名称；地址、密钥这些细节在编辑页里看 */}
                <th scope="row">
                  <span className="cell-title">
                    {endpoint.name}
                    {endpoint.kind === "fake" ? (
                      <Tag>测试用</Tag>
                    ) : isConfigured(endpoint) ? null : (
                      <Tag tone="warning">待配置</Tag>
                    )}
                  </span>
                </th>
                {/* 每个接口选用一个模型，只列这一个 */}
                <td data-label="模型" className="nowrap">
                  {endpoint.models.length > 1
                    ? `${endpoint.models[0]} 等 ${endpoint.models.length} 个`
                    : (endpoint.models[0] ?? "—")}
                </td>
                <td className="numeric" data-label="并发上限">
                  {endpoint.concurrency}
                </td>
                <td
                  className="numeric"
                  data-label="单价（元 / 百万 token）"
                >
                  {endpoint.price === null ? "—" : endpoint.price}
                </td>
                <td className="numeric" data-label="使用">
                  {used ? `${used} 个任务` : "—"}
                </td>
                <td className="numeric cell-action">
                  <SharingButton kind="llm" resource={endpoint} />
                  {endpoint.kind === "fake" ||
                  (endpoint.resourceSpace !== "workspace" &&
                    !endpoint.builtin) ? null : (
                    <a
                      className="button button--secondary button--compact"
                      href={hrefOf({
                        page: "editEndpoint",
                        id: endpoint.id,
                      })}
                      aria-label={`编辑“${endpoint.name}”`}
                    >
                      编辑
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
      </ResourceTable>
    </>
  );
}
