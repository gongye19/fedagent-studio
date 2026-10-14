import { hrefOf } from "../../state/route";
import { PanelEmpty, Tag } from "../common";
import { Panel } from "../console";
import type { Endpoint } from "../../domain/resources";

export function ModelResources({ models, own, keyword }: { models: Endpoint[]; own: boolean; keyword: string }) {
  return (
    <Panel title="模型接口" extra={`${models.length} 个`} flush>
      {models.length ? (
        <div className="table-shell">
          <table className="table table--stack">
            <thead>
              <tr>
                <th scope="col">接口名称</th>
                <th scope="col">模型</th>
                <th scope="col">配置状态</th>
                {own ? <th scope="col">操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {models.map((e) => (
                <tr key={e.id}>
                  <th scope="row">{e.name}</th>
                  <td data-label="模型">{e.models[0] ?? "未选择"}</td>
                  <td data-label="配置状态">{e.configured ? "已配置" : <Tag tone="warning">待配置</Tag>}</td>
                  {own ? (
                    <td data-label="操作">
                      <a className="text-link" href={hrefOf({ page: "editEndpoint", id: e.id })}>
                        编辑
                      </a>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <PanelEmpty>
          {keyword ? "没有匹配的模型接口。" : own ? "可以使用公用模型，也可以接入自己的模型接口。" : "暂无公用模型。"}
        </PanelEmpty>
      )}
    </Panel>
  );
}
