import type { ChangeEvent, DragEvent } from "react";
import { participantPool } from "../domain/demo";
import type { FrontendRunPlan } from "../domain/plan";
import { PRESET_LABEL, type ExecutionPreset } from "../domain/run";
import type { Action, State } from "../state/store";
import { Facts, StageMessage } from "./common";

const INPUT_KIND_LABEL = {
  nodes: "连接节点",
  files: "上传文件",
  endpoints: "注册 Endpoint",
} as const;

export default function InputsStep({
  state, plan, dispatch,
}: {
  state: State;
  plan: FrontendRunPlan | null;
  dispatch: (action: Action) => void;
}) {
  if (!plan) return <div className="step-pad"><StageMessage text="先在 Configuration 完成全部维度，平台才能确定需要哪种输入。" /></div>;

  const locked = Boolean(state.run);
  const participants = state.run?.participants ?? state.participants;
  const pool = participantPool(plan.scenario.id, state.selection.contribution);
  const canAdd = !locked && pool.some((candidate) => !participants.some((participant) => participant.id === candidate.id));

  function upload(files: FileList | null) {
    if (!files?.length) return;
    dispatch({
      type: "uploadFiles",
      files: Array.from(files).map((file) => ({ name: file.name, size: file.size, lastModified: file.lastModified })),
    });
  }

  return (
    <div className="inputs-workspace">
      <Facts
        items={[
          ["接入方式", `${INPUT_KIND_LABEL[plan.input.kind]} · ${plan.input.label}`],
          ["参与方侧", plan.locations.participantWorker],
          ["最少参与方", `${plan.minParticipants} 个`],
        ]}
      />

      <section className="participants" aria-labelledby="participants-title">
        <header className="section-head">
          <h3 id="participants-title">参与方（{participants.length}）</h3>
          <button type="button" className="button button--secondary button--small" disabled={!canAdd} onClick={() => dispatch({ type: "addParticipant" })}>
            添加示例参与方
          </button>
        </header>
        <ul className="participant-list">
          {participants.map((participant) => (
            <li className="participant-row" key={participant.id}>
              <div>
                <strong>{participant.name}</strong>
                <span className="badge">{participant.role}</span>
              </div>
              <p>{participant.provides} · {participant.detail}</p>
              {!locked ? (
                <button type="button" className="remove-button" aria-label={`移除 ${participant.name}`} onClick={() => dispatch({ type: "removeParticipant", id: participant.id })}>
                  移除
                </button>
              ) : <span className="input-ready">已冻结</span>}
            </li>
          ))}
          {!participants.length ? <li className="participant-empty">还没有参与方。</li> : null}
        </ul>
        {participants.length < plan.minParticipants ? (
          <p className="option-reason">至少需要 {plan.minParticipants} 个参与方才能开始准入检查。</p>
        ) : null}
      </section>

      {plan.input.kind === "files" && !locked ? (
        <label
          className="upload-zone"
          onDragOver={(event: DragEvent<HTMLLabelElement>) => event.preventDefault()}
          onDrop={(event: DragEvent<HTMLLabelElement>) => {
            event.preventDefault();
            upload(event.dataTransfer.files);
          }}
        >
          <input
            type="file"
            multiple
            accept={plan.input.accept}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              upload(event.target.files);
              event.target.value = "";
            }}
          />
          <strong>拖入产物文件，或点击选择</strong>
          <span>{plan.input.accept}</span>
          <small>前端模拟：只记录文件名和大小，不读取、不上传文件内容</small>
        </label>
      ) : null}

      <section className="run-settings" aria-labelledby="run-settings-title">
        <header className="section-head"><h3 id="run-settings-title">运行设置</h3></header>
        <div className="segmented" role="radiogroup" aria-label="执行预设">
          {(Object.keys(PRESET_LABEL) as ExecutionPreset[]).map((preset) => (
            <button
              type="button"
              role="radio"
              aria-checked={(state.run?.preset ?? state.preset) === preset}
              key={preset}
              disabled={locked}
              onClick={() => dispatch({ type: "setPreset", preset })}
            >
              {PRESET_LABEL[preset]}
            </button>
          ))}
        </div>
        <div className="segmented" role="radiogroup" aria-label="运行环境">
          <button type="button" role="radio" aria-checked="true" disabled={locked}>前端模拟</button>
          <button type="button" role="radio" aria-checked="false" disabled title="后端未接入">真实运行 · 后端未接入</button>
        </div>
      </section>
    </div>
  );
}
