import { MEDICAL_RECORDS } from "../domain/consultation";
import { visibleApplicationType } from "../domain/catalog";
import { hrefOf } from "../state/route";
import { useState } from "react";
import { availableResource } from "../domain/resources";
import { navigate, type Route } from "../state/route";
import type { State } from "../state/store";
import { PageHead } from "./common";
import { Icon } from "./icons";
import { DataResources } from "./resources/DataResources";
import { ResourceIntakeDialog } from "./ResourceIntakeDialog";

export default function ResourcesPage({
  state,
  selectedId,
  upload,
}: {
  state: State;
  selectedId?: string;
  upload?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const route = (id?: string): Route => ({
    page: "resources",
    id,
  });
  const data = state.datasets.filter((d) => visibleApplicationType(d.taskType) && availableResource(d));
  const selected = data.find((item) => item.id === selectedId && item.taskType === MEDICAL_RECORDS && item.ready);
  function closeUpload() {
    setAdding(false);
    if (upload) navigate(route(), { keepScroll: true });
  }
  return (
    <>
      <PageHead
        title="联邦数据"
        back={selectedId ? {label: "联邦数据", route: route()} : undefined}
        meta="上传的数据可用于联邦任务。目录只展示数据的基本信息。"
        actions={<button type="button" className="button button--primary" onClick={() => setAdding(true)}>
          <Icon name="plus" />上传数据
        </button>}
      />
      {selected ? <div className="detail-actions medical-data-next">
        <a className="button button--secondary" href={hrefOf({ page: "newTask", dataset: selected.id })}>用这份记录生成经验包</a>
      </div> : null}
      <DataResources
        state={state}
        datasets={data}
        selectedId={selectedId}
        onSelect={(id) => navigate(route(id), { keepScroll: true })}
      />
      <ResourceIntakeDialog
        state={state}
        kind={adding || upload ? "data" : null}
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
