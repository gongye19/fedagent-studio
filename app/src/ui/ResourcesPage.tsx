import { useState } from "react";
import { ALGORITHMS } from "../domain/catalog";
import { type ResourceSpace } from "../domain/resources";
import { hrefOf, navigate, type ResourceKind, type Route } from "../state/route";
import type { State } from "../state/store";
import { PageHead, SearchInput, TabLinks } from "./common";
import { TaskTypeSelect, type TaskTypeFilter } from "./filters";
import { Icon } from "./icons";
import { InfoTip } from "./InfoTip";
import { useContentMotion } from "./hooks";
import { DataResources } from "./resources/DataResources";
import { ModelResources } from "./resources/ModelResources";
import { ExecutionResources } from "./resources/ExecutionResources";
import { ResourceIntakeDialog } from "./ResourceIntakeDialog";

const KIND_LABELS: Record<ResourceKind, string> = { data: "数据", models: "模型接口", agents: "Agent / 执行环境" };
export default function ResourcesPage({
  state,
  space = "workspace",
  kind = "data",
  selectedId,
}: {
  state: State;
  space?: ResourceSpace;
  kind?: ResourceKind;
  selectedId?: string;
}) {
  const [query, setQuery] = useState("");
  const [taskType, setTaskType] = useState<TaskTypeFilter>("all");
  const [adding, setAdding] = useState<"data" | "model" | null>(null);
  const panelMotion = useContentMotion(`${space}:${kind}`, true);
  const own = space === "workspace";
  const keyword = query.trim().toLowerCase();
  const route = (k: ResourceKind, id?: string): Route => ({ page: "resources", space, kind: k, id });
  const data = state.datasets.filter(
    (d) =>
      d.resourceSpace === space &&
      (!keyword || d.name.toLowerCase().includes(keyword)) &&
      (taskType === "all" || d.taskType === taskType),
  );
  const models = state.endpoints.filter(
    (e) => e.resourceSpace === space && (!keyword || `${e.name} ${e.models.join(" ")}`.toLowerCase().includes(keyword)),
  );
  const agents = state.participants.filter(
    (p) =>
      p.hosting === "local" &&
      !p.builtin &&
      (!keyword || p.name.toLowerCase().includes(keyword)) &&
      (taskType === "all" || state.datasets.some((d) => d.participantId === p.id && d.taskType === taskType)),
  );
  const flows = ALGORITHMS.filter(
    (a) => (!keyword || a.name.toLowerCase().includes(keyword)) && (taskType === "all" || a.accepts.includes(taskType)),
  );
  return (
    <>
      <PageHead
        title="资源"
        meta={own ? "接入一次，后续任务可直接选择使用。" : "平台提供的基准数据、模型与执行流程。"}
        actions={
          own && kind !== "agents" ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => setAdding(kind === "data" ? "data" : "model")}
            >
              <Icon name="plus" />
              {kind === "data" ? "接入数据" : "接入模型接口"}
            </button>
          ) : undefined
        }
      />
      <nav className="resource-space-bar" aria-label="资源归属">
        <a
          className={own ? "resource-space-link resource-space-link--active" : "resource-space-link"}
          href={hrefOf({ page: "resources", space: "workspace", kind })}
          aria-current={own ? "page" : undefined}
        >
          我的资源
        </a>
        <a
          className={!own ? "resource-space-link resource-space-link--active" : "resource-space-link"}
          href={hrefOf({ page: "resources", space: "public", kind })}
          aria-current={!own ? "page" : undefined}
        >
          公用资源
        </a>
        {own ? (
          <InfoTip label="资源归属">
            当前平台共用一个工作区，“我的资源”是此工作区接入的数据、模型接口和本地执行连接；多用户账号隔离尚未开放。平台运行的数据会存入这个工作区。
          </InfoTip>
        ) : null}
      </nav>
      <TabLinks
        label="资源类型"
        active={kind}
        routeOf={route}
        tabs={(Object.keys(KIND_LABELS) as ResourceKind[]).map((k) => ({ id: k, label: KIND_LABELS[k] }))}
      />
      <div className="list-toolbar" role="search" aria-label="筛选资源">
        <SearchInput
          name="resource-search"
          aria-label="搜索资源"
          placeholder="搜索资源名称…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {kind !== "models" ? <TaskTypeSelect value={taskType} onChange={setTaskType} /> : null}
        {query || taskType !== "all" ? (
          <button
            type="button"
            className="button button--ghost button--compact"
            onClick={() => {
              setQuery("");
              setTaskType("all");
            }}
          >
            清除筛选
          </button>
        ) : null}
      </div>
      <div ref={panelMotion}>
        {kind === "data" ? (
          <DataResources
            state={state}
            datasets={data}
            own={own}
            filtering={Boolean(query || taskType !== "all")}
            selectedId={selectedId}
            onAdd={() => setAdding("data")}
            onSelect={(id) => navigate(route("data", id), { keepScroll: true })}
          />
        ) : kind === "models" ? (
          <ModelResources models={models} own={own} keyword={keyword} />
        ) : (
          <ExecutionResources state={state} own={own} agents={agents} flows={flows} />
        )}
      </div>
      {state.draft.touched && state.draft.algorithm ? (
        <div className="resource-return">
          <a className="text-link" href={hrefOf({ page: "newTask", scenario: state.draft.scenario ?? undefined })}>
            返回任务配置
          </a>
        </div>
      ) : null}
      <ResourceIntakeDialog
        state={state}
        kind={adding}
        title={adding === "data" ? "接入我的数据" : "接入我的模型接口"}
        onClose={() => setAdding(null)}
        onSaved={(saved) => {
          setAdding(null);
          if (saved.kind === "data") navigate(route("data", saved.value.dataset.id));
        }}
      />
    </>
  );
}
