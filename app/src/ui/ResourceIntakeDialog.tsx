import { useState } from "react";
import type { components } from "../api/schema";
import type { ScenarioId, TaskType } from "../domain/catalog";
import type { Endpoint } from "../domain/resources";
import type { State } from "../state/store";
import { DataResourceForm } from "./DataResourceForm";
import { EndpointForm } from "./EndpointPage";
import { ResourceDialog } from "./ResourceDialog";

export type SavedResource =
  { kind: "data"; value: components["schemas"]["DataResourceOut"] } | { kind: "model"; value: Endpoint };

/** 任务页与资源页共用接入流程；忙碌、关闭和焦点规则只维护一处。 */
export function ResourceIntakeDialog({
  kind,
  state,
  category,
  title,
  onClose,
  onSaved,
}: {
  kind: "data" | "model" | null;
  state: State;
  category?: { scenario: ScenarioId; taskType: TaskType };
  title?: string;
  onClose: () => void;
  onSaved: (resource: SavedResource) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <ResourceDialog
      title={title ?? (kind === "data" ? "接入数据" : "接入模型接口")}
      open={kind !== null}
      busy={busy}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {kind === "data" ? (
        <DataResourceForm
          state={state}
          category={category}
          onBusyChange={setBusy}
          onCancel={onClose}
          onSaved={(value) => onSaved({ kind: "data", value })}
        />
      ) : kind === "model" ? (
        <EndpointForm
          state={state}
          onBusyChange={setBusy}
          onCancel={onClose}
          onSaved={(value) => onSaved({ kind: "model", value })}
        />
      ) : null}
    </ResourceDialog>
  );
}
