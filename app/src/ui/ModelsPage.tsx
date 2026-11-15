import { useState } from "react";
import { api } from "../api/client";
import { availableResource, DEFAULT_ENDPOINT_ID, isPlatformEndpoint } from "../domain/resources";
import { hrefOf } from "../state/route";
import { keys, queryClient } from "../state/server";
import type { State } from "../state/store";
import { CheckStatus } from "./CheckStatus";
import { PageHead, Tag } from "./common";
import { Icon } from "./icons";
import { SharingButton } from "./resources/SharingButton";
import { ResourceTable } from "./resources/ResourceTable";

/** 平台接口只读；自行接入的接口在同一目录管理、验证与选择。 */
export default function ModelsPage({ state }: { state: State }) {
  const [checking, setChecking] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const endpoints = state.endpoints.filter((item) => isPlatformEndpoint(item) || availableResource(item))
    .sort((a, b) => Number(b.id === DEFAULT_ENDPOINT_ID) - Number(a.id === DEFAULT_ENDPOINT_ID)
      || Number(isPlatformEndpoint(b)) - Number(isPlatformEndpoint(a)));
  async function verify(id: string) {
    setChecking(id);
    setErrors((old) => ({ ...old, [id]: "" }));
    try {
      const report = await api.testEndpoint(id);
      if (!report.ok) setErrors((old) => ({ ...old, [id]: report.message }));
      await queryClient.invalidateQueries({ queryKey: keys.endpoints });
    } catch (error) {
      setErrors((old) => ({ ...old, [id]: error instanceof Error ? error.message : "验证失败，请重试" }));
    } finally { setChecking(null); }
  }
  return <>
    <PageHead title="大模型接口" meta="默认使用平台模型，可添加自己的模型接口。"
      actions={<a className="button button--primary" href={hrefOf({ page: "newEndpoint" })}>
        <Icon name="plus" />添加大模型接口
      </a>} />
    <ResourceTable label="大模型接口列表" className="table--models" columns={[
      { label: "接口名称" }, { label: "模型" }, { label: "来源" }, { label: "状态" },
      { label: "操作", className: "numeric" },
    ]} empty={!endpoints.length} emptyContent="暂无模型接口。添加并验证后即可使用。">
      {endpoints.map((endpoint) => {
        const platform = isPlatformEndpoint(endpoint);
        const editable = !platform && endpoint.resourceSpace === "workspace";
        const status = checking === endpoint.id ? "running" : errors[endpoint.id] ? "failed"
          : endpoint.verified ? "passed" : "pending";
        return <tr key={endpoint.id}>
          <th scope="row">{endpoint.name}</th>
          <td data-label="模型">{endpoint.models.join("、") || "—"}</td>
          <td data-label="来源"><Tag tone={platform ? "info" : "neutral"}>
            {endpoint.kind === "fake" ? "本地测试" : platform ? "平台默认" : editable ? endpoint.shared ? "自行接入 · 已共享" : "自行接入" : "已共享"}
          </Tag></td>
          <td data-label="状态"><span className="model-availability">
            <CheckStatus status={status} />
            <span>{status === "running" ? "验证中" : status === "failed" ? "验证失败"
              : status === "passed" ? "可用" : endpoint.configured ? "待验证" : "待配置"}</span>
          </span></td>
          <td className="numeric cell-action" data-label="操作">
            {editable ? <div className="model-actions">
              {endpoint.configured ? <button type="button" className="button button--ghost button--compact"
                disabled={checking !== null} onClick={() => void verify(endpoint.id)}>验证</button> : null}
              {endpoint.shared ? <SharingButton kind="llm" resource={endpoint} /> : null}
              <a className="button button--secondary button--compact" aria-label={`编辑“${endpoint.name}”`}
                href={hrefOf({ page: "editEndpoint", id: endpoint.id })}>编辑</a>
            </div> : <span className="muted model-readonly">{platform ? "平台维护" : "只读"}</span>}
            {errors[endpoint.id] ? <p className="field-error" role="alert">{errors[endpoint.id]}</p> : null}
          </td>
        </tr>;
      })}
    </ResourceTable>
  </>;
}
