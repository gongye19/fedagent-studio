import { MEDICAL_RECORDS } from "../domain/consultation";
import { visibleTaskType } from "../domain/catalog";
import { hrefOf } from "../state/route";
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
  upload,
}: {
  state: State;
  space?: ResourceSpace;
  selectedId?: string;
  upload?: boolean;
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
  const data = state.datasets.filter((d) => visibleTaskType(d.taskType) && inResourceScope(d, space));
  const selected = data.find((item) => item.id === selectedId && item.taskType === MEDICAL_RECORDS && item.ready);
  function closeUpload() {
    setAdding(false);
    if (upload) navigate(route(), { keepScroll: true });
  }
  return (
    <>
      <PageHead
        title="数据资源"
        back={selectedId ? {label: "数据资源", route: route()} : undefined}
        meta={
          own
            ? "上传已完成的问诊过程，校验后用于生成经验。"
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
      {selected ? <div className="detail-actions medical-data-next">
        <a className="button button--secondary" href={hrefOf({ page: "newTask", dataset: selected.id })}>用这份记录生成经验包</a>
      </div> : null}
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
        kind={own && (adding || upload) ? "data" : null}
        category={{ scenario: "horizontal", taskType: MEDICAL_RECORDS }}
        title="上传问诊记录"
        onClose={closeUpload}
        onSaved={(saved) => {
          setAdding(false);
          if (saved.kind === "data") navigate(route(saved.value.dataset.id));
        }}
      />
    </>
  );
}
