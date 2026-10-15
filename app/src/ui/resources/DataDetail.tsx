import { useState } from "react";
import { type Dataset } from "../../domain/resources";
import { deleteDataResource } from "../../state/actions";
import type { State } from "../../state/store";
import { Collapsible, Confirm, Facts } from "../common";
import { LocalConnect } from "../ParticipantsPage";

export function DataDetail({ state, dataset, onRemoved }: { state: State; dataset: Dataset; onRemoved: () => void }) {
  const [removing, setRemoving] = useState(false);
  const source = state.participants.find((p) => p.id === dataset.participantId);
  return (
    <div className="participant-detail">
      <Facts
        items={[
          ["数据来源", source?.name ?? "来源已删除"],
          ["数据规范", dataset.schemaVersion],
          ["已标注", `${dataset.answered} / ${dataset.count}`],
          ["说明", dataset.description || "—"],
        ]}
      />
      {dataset.sample ? (
        <Collapsible title="样本预览" className="sample-preview">
          <div className="sample-question">
            {dataset.sample.fields?.length ? (
              dataset.sample.fields.map((f) => (
                <div key={f.label}>
                  <strong>{f.label}</strong>
                  <p>{f.text}</p>
                </div>
              ))
            ) : (
              <>
                <p>{dataset.sample.question}</p>
                {dataset.sample.answer ? <p className="sample-answer">标注：{dataset.sample.answer}</p> : null}
              </>
            )}
          </div>
        </Collapsible>
      ) : null}
      {source?.hosting === "local" ? (
        <LocalConnect
          participantId={source.id}
          datasetIds={state.datasets.filter((d) => d.participantId === source.id).map((d) => d.id)}
        />
      ) : null}
      {dataset.resourceSpace === "workspace" ? (
        <div className="detail-actions">
          <button
            type="button"
            className="button button--secondary button--compact button--danger"
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
