import { useState } from "react";
import { inResourceScope, type ResourceSpace } from "../domain/resources";
import { navigate, type Route } from "../state/route";
import type { State } from "../state/store";
import { PageHead } from "./common";
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
  const [adding, setAdding] = useState(false);
  const panelMotion = useContentMotion(space, true);
  const own = space === "workspace";
  const route = (id?: string): Route => ({
    page: "resources",
    space,
    kind: "data",
    id,
  });
  const data = state.datasets.filter((d) => inResourceScope(d, space));
  return (
    <>
      <PageHead
        title="数据资源"
        back={selectedId ? {label: "数据资源", route: route()} : undefined}
        meta={
          own
            ? "上传已完成的问诊或解题过程，校验后用于生成经验。"
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
      <div ref={panelMotion}>
        <DataResources
          state={state}
          datasets={data}
          own={own}
          selectedId={selectedId}
          onSelect={(id) => navigate(route(id), { keepScroll: true })}
        />
      </div>
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
