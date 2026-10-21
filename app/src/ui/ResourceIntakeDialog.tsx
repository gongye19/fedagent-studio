import type { AgentEndpoint } from "../api/agents";
import { AgentEndpointForm } from "./AgentEndpointForm";
import { useState } from "react";
import type { components } from "../api/schema";
import type { ScenarioId, TaskType } from "../domain/catalog";
import type { Endpoint } from "../domain/resources";
import type { State } from "../state/store";
import { DataResourceForm } from "./DataResourceForm";
import { EndpointForm } from "./EndpointPage";
import { ResourceDialog } from "./ResourceDialog";

export type SavedResource =
  { kind: "data"; value: components["schemas"]["DataResourceOut"] } | { kind: "model"; value: Endpoint } | { kind: "agent"; value: AgentEndpoint };

/** 资源页的接入窗口；复用表单与统一的忙碌、关闭和焦点规则。 */
export function ResourceIntakeDialog({
  kind,
  state,
  category,
  title,
  onClose,
  onSaved,
}: {
  kind: "data" | "model" | "agent" | null;
  state: State;
  category?: { scenario: ScenarioId; taskType: TaskType };
  title?: string;
  onClose: () => void;
  onSaved: (resource: SavedResource) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <ResourceDialog
      title={title ?? (kind === "data" ? "上传数据" : kind === "agent" ? "接入 Agent" : "接入 LLM 接口")}
      open={kind !== null}
      busy={busy}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {kind === "data" ? (
        <DataResourceForm
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
      ) : kind === "agent" ? <AgentEndpointForm onBusyChange={setBusy} onCancel={onClose} onSaved={(value) => onSaved({ kind: "agent", value })} /> : null}
    </ResourceDialog>
  );
}
