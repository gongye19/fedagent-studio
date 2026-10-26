import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentsApi, type AgentEndpoint } from "../api/agents";
import { inResourceScope, type ResourceSpace } from "../domain/resources";
import { ALGORITHMS } from "../domain/catalog";
import { keys, queryClient } from "../state/server";
import { Confirm, PageHead, Tag } from "./common";
import { ResourceTable } from "./resources/ResourceTable";
import { SharingButton } from "./resources/SharingButton";
import { ResourceScope } from "./resources/ResourceScope";
import { ResourceDialog } from "./ResourceDialog";
import { AgentEndpointForm } from "./AgentEndpointForm";
import { Icon } from "./icons";
import { CheckStatus } from "./CheckStatus";
import { AgentVerificationDialog } from "./AgentVerificationDialog";

export default function AgentsPage({
  space = "workspace",
}: {
  space?: ResourceSpace;
}) {
  const query = useQuery({ queryKey: keys.agents, queryFn: agentsApi.list,
    refetchInterval: (query) => query.state.data?.some((agent) => agent.verifications?.some((v) => ["queued", "running"].includes(v.report.status))) ? 1000 : false });
  const [editing, setEditing] = useState<AgentEndpoint | "new" | null>(null);
  const [deleting, setDeleting] = useState<AgentEndpoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState<AgentEndpoint | null>(null);
  const rows = (query.data ?? []).filter((a) => inResourceScope(a, space));
  return (
    <>
      <PageHead
        title="Agent 接口"
        meta="接入能独立执行任务的 Agent；与只提供推理能力的 LLM 接口分开管理。"
        actions={
          space === "workspace" ? (
            <button
              className="button button--primary"
              onClick={() => setEditing("new")}
            >
              <Icon name="plus" />
              接入 Agent
            </button>
          ) : undefined
        }
      />
      <ResourceScope
        space={space}
        routeOf={(value) => ({ page: "agents", space: value })}
      />
      <ResourceTable label="Agent 接口列表" columns={[
        {label: "接口名称"}, {label: "所属方"}, {label: "支持的算法"},
        {label: "接入验证"}, {label: "操作"},
      ]} empty={!rows.length} busy={query.isPending} emptyContent={
        query.isPending ? "正在读取接口…" : query.error ? <>
          <span>接口列表暂时无法读取。</span>
          <button className="button button--secondary" onClick={() => void query.refetch()}>重新加载</button>
        </> : space === "workspace"
          ? "尚未接入 Agent，可使用共享接口，或接入自己的接口。"
          : "暂无共享 Agent 接口。"
      }>
        {rows.map((a) => (
          <tr key={a.id}>
            <th scope="row">
              <span className="cell-title">
                {a.name}
                {a.resourceSpace === "workspace" && a.shared ? (
                  <Tag>已共享</Tag>
                ) : null}
              </span>
            </th>
            <td data-label="所属方">{a.ownerName}</td>
            <td data-label="支持的算法">
              {a.capabilities
                ? Object.keys(a.capabilities.algorithms)
                    .map(
                      (id) =>
                        ALGORITHMS.find((item) => item.id === id)
                          ?.name ?? id,
                    )
                    .join("、") || "未声明"
                : "—"}
            </td>
            <td data-label="接入验证">
              <CheckStatus status={(a.verifications ?? []).some((v) => ["queued", "running"].includes(v.report.status)) ? "running"
                : (a.verifications ?? []).some((v) => v.current) ? "passed" : (a.verifications ?? []).some((v) => v.report.status === "failed") ? "failed" : "pending"} />
            </td>
            <td data-label="操作">
              <div className="button-group">
                <SharingButton kind="agent" resource={a} />
                <button
                  className="button button--secondary button--compact"
                  onClick={() => setVerifying(a)}
                >
                  验证接入
                </button>
                {a.resourceSpace === "workspace" ? (
                  <>
                    <button
                      className="button button--ghost button--compact"
                      onClick={() => setEditing(a)}
                    >
                      编辑
                    </button>
                    <button
                      className="button button--ghost button--compact"
                      onClick={() => setDeleting(a)}
                    >
                      删除
                    </button>
                  </>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </ResourceTable>
      <ResourceDialog
        title={editing === "new" ? "接入 Agent" : "编辑 Agent 接口"}
        open={editing !== null}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing ? (
          <AgentEndpointForm
            endpoint={editing === "new" ? undefined : editing}
            onBusyChange={setBusy}
            onCancel={() => setEditing(null)}
            onSaved={(agent) => { setEditing(null); setVerifying(agent); }}
          />
        ) : null}
      </ResourceDialog>
      {verifying ? <AgentVerificationDialog key={verifying.id} agent={verifying} onClose={() => setVerifying(null)} /> : null}
      {deleting ? (
        <Confirm
          title={`删除“${deleting.name}”？`}
          confirmLabel="删除"
          cancelLabel="取消"
          tone="danger"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await agentsApi.remove(deleting.id);
            await queryClient.invalidateQueries({ queryKey: keys.agents });
            setDeleting(null);
          }}
        >
          正在使用的接口需要等任务结束后才能删除。
        </Confirm>
      ) : null}
    </>
  );
}
