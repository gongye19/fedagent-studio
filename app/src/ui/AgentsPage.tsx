import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentsApi, type AgentEndpoint } from "../api/agents";
import { inResourceScope, type ResourceSpace } from "../domain/resources";
import { ALGORITHMS } from "../domain/catalog";
import { keys, queryClient } from "../state/server";
import { Confirm, PageHead, PanelEmpty, Tag } from "./common";
import { Panel } from "./console";
import { SharingButton } from "./resources/SharingButton";
import { ResourceScope } from "./resources/ResourceScope";
import { ResourceDialog } from "./ResourceDialog";
import { AgentEndpointForm } from "./AgentEndpointForm";
import { Icon } from "./icons";

export default function AgentsPage({
  space = "workspace",
}: {
  space?: ResourceSpace;
}) {
  const query = useQuery({ queryKey: keys.agents, queryFn: agentsApi.list });
  const [editing, setEditing] = useState<AgentEndpoint | "new" | null>(null);
  const [deleting, setDeleting] = useState<AgentEndpoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = (query.data ?? []).filter((a) => inResourceScope(a, space));
  async function check(id: string) {
    setChecking(id);
    setError(null);
    try {
      await agentsApi.check(id);
      await queryClient.invalidateQueries({ queryKey: keys.agents });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "检查失败");
    } finally {
      setChecking(null);
    }
  }
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
      <Panel flush>
        {rows.length ? (
          <div className="table-shell">
            <table className="table table--stack">
              <thead>
                <tr>
                  <th scope="col">接口名称</th>
                  <th scope="col">所属方</th>
                  <th scope="col">支持的算法</th>
                  <th scope="col">能力检查</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
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
                    <td data-label="能力检查">
                      {a.capabilities ? (
                        <Tag>已读取能力</Tag>
                      ) : (
                        <Tag tone="warning">待检查</Tag>
                      )}
                    </td>
                    <td data-label="操作">
                      <div className="button-group">
                        <SharingButton kind="agent" resource={a} />
                        <button
                          className="button button--secondary button--compact"
                          disabled={Boolean(checking)}
                          onClick={() => void check(a.id)}
                        >
                          {checking === a.id ? "检查中…" : "检查能力"}
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
              </tbody>
            </table>
          </div>
        ) : (
          <PanelEmpty>
            {query.isPending
              ? "正在读取接口…"
              : query.error
                ? "接口列表暂时无法读取，请重试。"
                : "暂无 Agent 接口。需要自有 Agent 的算法，请先接入支持其完整步骤的服务。"}
          </PanelEmpty>
        )}
      </Panel>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
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
            onSaved={() => setEditing(null)}
          />
        ) : null}
      </ResourceDialog>
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
