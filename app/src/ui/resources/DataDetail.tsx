import { useState } from "react";
import { type Dataset } from "../../domain/resources";
import { deleteDataResource } from "../../state/actions";
import type { State } from "../../state/store";
import { Confirm } from "../common";
import { LocalConnect } from "../ParticipantsPage";

export function DataDetail({
  state,
  dataset,
  onRemoved,
}: {
  state: State;
  dataset: Dataset;
  onRemoved: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  const source = state.participants.find((p) => p.id === dataset.participantId);
  return (
    <div className="dataset-detail">
      <dl className="dataset-metadata">
        <div><dt>数据来源</dt><dd>{source?.name ?? "来源已删除"}</dd></div>
        <div><dt>数据格式</dt><dd>{dataset.schemaVersion}</dd></div>
        <div><dt>参考答案</dt><dd>{dataset.answered} / {dataset.count} 条已标注</dd></div>
      </dl>
      {dataset.description ? <p className="dataset-description">{dataset.description}</p> : null}
      {source?.hosting === "local" ? (
        <LocalConnect
          participantId={source.id}
          datasetIds={state.datasets
            .filter((d) => d.participantId === source.id)
            .map((d) => d.id)}
        />
      ) : null}
      {dataset.resourceSpace === "workspace" ? (
        <div className="dataset-actions">
          <button
            type="button"
            className="button button--ghost button--compact button--danger"
            onClick={() => setRemoving(true)}
          >
            删除数据
          </button>
        </div>
      ) : null}
      {removing ? (
        <Confirm
          title={`删除“${dataset.name}”？`}
          confirmLabel="删除"
          onCancel={() => setRemoving(false)}
          onConfirm={async () => {
            await deleteDataResource(dataset.id);
            onRemoved();
          }}
        >
          只删除这份数据的登记，已运行任务的记录保留。
          {source?.hosting === "local" ? "本地客户端连接也会保留。" : null}
        </Confirm>
      ) : null}
    </div>
  );
}
