import { useState } from "react";
import { inResourceScope, type ResourceSpace } from "../domain/resources";
import { hrefOf, navigate, type Route } from "../state/route";
import type { State } from "../state/store";
import { PageHead, SearchInput } from "./common";
import { TaskTypeSelect, type TaskTypeFilter } from "./filters";
import { Icon } from "./icons";
import { ResourceScope } from "./resources/ResourceScope";
import { useContentMotion } from "./hooks";
import { DataResources } from "./resources/DataResources";
import { ResourceIntakeDialog } from "./ResourceIntakeDialog";

export default function ResourcesPage({
  state,
  space = "workspace",
  selectedId,
}: {
  state: State;
  space?: ResourceSpace;
  selectedId?: string;
}) {
  const [query, setQuery] = useState("");
  const [taskType, setTaskType] = useState<TaskTypeFilter>("all");
  const [adding, setAdding] = useState(false);
  const panelMotion = useContentMotion(space, true);
  const own = space === "workspace";
  const keyword = query.trim().toLowerCase();
  const route = (id?: string): Route => ({
    page: "resources",
    space,
    kind: "data",
    id,
  });
  const data = state.datasets.filter(
    (d) =>
      inResourceScope(d, space) &&
      (!keyword || d.name.toLowerCase().includes(keyword)) &&
      (taskType === "all" || d.taskType === taskType),
  );
  return (
    <>
      <PageHead
        title="数据资源"
        back={selectedId ? {label: "数据资源", route: route()} : undefined}
        meta={
          own
            ? "接入一次，后续任务可直接选择使用。"
            : "用户共享及平台提供的可复用数据。"
        }
        actions={
          own ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => setAdding(true)}
            >
              <Icon name="plus" />
              上传数据
            </button>
          ) : undefined
        }
      />
      <ResourceScope
        space={space}
        routeOf={(value) => ({ page: "resources", space: value })}
      />
      <div className="list-toolbar" role="search" aria-label="筛选资源">
        <SearchInput
          name="resource-search"
          aria-label="搜索资源"
          placeholder="搜索资源名称…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <TaskTypeSelect value={taskType} onChange={setTaskType} />
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
        <DataResources
          state={state}
          datasets={data}
          own={own}
          filtering={Boolean(query || taskType !== "all")}
          selectedId={selectedId}
          onAdd={() => setAdding(true)}
          onSelect={(id) => navigate(route(id), { keepScroll: true })}
        />
      </div>
      {state.draft.touched && state.draft.algorithm ? (
        <div className="resource-return">
          <a
            className="text-link"
            href={hrefOf({
              page: "newTask",
              scenario: state.draft.scenario ?? undefined,
            })}
          >
            返回任务配置
          </a>
        </div>
      ) : null}
      <ResourceIntakeDialog
        state={state}
        kind={adding ? "data" : null}
        title="上传我的数据"
        onClose={() => setAdding(false)}
        onSaved={(saved) => {
          setAdding(false);
          if (saved.kind === "data") navigate(route(saved.value.dataset.id));
        }}
      />
    </>
  );
}
