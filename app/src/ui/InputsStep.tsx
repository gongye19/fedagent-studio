import type { ChangeEvent, DragEvent } from "react";
import { matchedDatasets } from "../domain/demo";
import { SAMPLE_BYTES, checkUpload, dataContract, isTextFile } from "../domain/inputs";
import type { FrontendRunPlan } from "../domain/plan";
import { PRESET_LABEL, type ExecutionPreset } from "../domain/run";
import { inputStatus, type Action, type State } from "../state/store";
import { StageMessage } from "./common";

/** Agent 检查的演示时长；检查本身在浏览器本地同步完成。 */
const CHECK_DEMO_MS = 900;

const STATUS_TEXT = { checking: "Agent 检查中", passed: "检查通过", failed: "未通过" } as const;

export default function InputsStep({
  state, plan, dispatch,
}: {
  state: State;
  plan: FrontendRunPlan | null;
  dispatch: (action: Action) => void;
}) {
  const scenario = state.selection.scenario;
  if (!plan || !scenario) return <div className="step-pad"><StageMessage text="先在 Configuration 选好场景、协作策略和安全与信任，平台才能确定需要什么数据。" /></div>;

  const locked = Boolean(state.run);
  const contract = dataContract(scenario, state.selection.contribution);
  const datasets = matchedDatasets(state.selection);
  const status = inputStatus(state, plan);

  async function upload(files: FileList | null) {
    if (!files?.length || locked) return;
    const list = Array.from(files).map((file) => ({ file, id: `upload-${file.name}-${file.size}-${file.lastModified}` }));
    dispatch({ type: "addUploads", files: list.map(({ file, id }) => ({ id, name: file.name, size: file.size })) });
    for (const { file, id } of list) {
      // 只在浏览器本地读取前 256KB 做结构检查，不上传、不保存文件内容。
      const sample = isTextFile(file.name) ? await file.slice(0, SAMPLE_BYTES).text() : undefined;
      const check = checkUpload(contract, { name: file.name, size: file.size, sample });
      setTimeout(() => dispatch({ type: "uploadChecked", id, check }), CHECK_DEMO_MS);
    }
  }

  return (
    <div className="inputs-workspace">
      <section className="data-contract" aria-labelledby="contract-title">
        <header className="section-head">
          <h3 id="contract-title">数据要求 · {contract.title}</h3>
          <span className="badge">至少 {plan.minParticipants} 份数据</span>
        </header>
        <ul>
          {contract.requirements.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section aria-labelledby="catalog-title">
        <header className="section-head">
          <h3 id="catalog-title">匹配到的联邦数据（{datasets.length}）</h3>
        </header>
        <p className="section-note">按前面的选择从已登记的数据中匹配。数据留在各参与方本地，平台只登记契约和摘要。</p>
        <ul className="dataset-list">
          {datasets.map((entry) => {
            const checked = state.datasetIds.includes(entry.id);
            return (
              <li key={entry.id}>
                <label className={`dataset-row${checked ? " dataset-row--checked" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={() => dispatch({ type: "toggleDataset", id: entry.id })}
                  />
                  <span className="dataset-copy">
                    <span className="dataset-title">
                      <strong>{entry.name}</strong>
                      <span className="badge">{entry.role}</span>
                    </span>
                    <small>{entry.provides} · {entry.detail}</small>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="upload-title">
        <header className="section-head">
          <h3 id="upload-title">上传自己的数据</h3>
        </header>
        {!locked ? (
          <label
            className="upload-zone"
            onDragOver={(event: DragEvent<HTMLLabelElement>) => event.preventDefault()}
            onDrop={(event: DragEvent<HTMLLabelElement>) => {
              event.preventDefault();
              void upload(event.dataTransfer.files);
            }}
          >
            <input
              type="file"
              multiple
              accept={contract.accept.join(",")}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                void upload(event.target.files);
                event.target.value = "";
              }}
            />
            <strong>拖入文件，或点击选择</strong>
            <span>{contract.accept.join(" / ")}</span>
            <small>上传后由 Agent 检查格式、字段和条数。文件只在浏览器本地读取前 256KB，不会上传或保存。</small>
          </label>
        ) : null}

        {state.uploads.length ? (
          <ul className="upload-results">
            {state.uploads.map((item) => (
              <li className={`upload-result upload-result--${item.status}`} key={item.id}>
                <header>
                  <strong>{item.name}</strong>
                  <span className={`status${item.status === "passed" ? " status--complete" : item.status === "failed" ? " status--failed" : " status--running"}`}>
                    {STATUS_TEXT[item.status]}
                  </span>
                  {!locked ? (
                    <button type="button" className="remove-button" aria-label={`移除 ${item.name}`} onClick={() => dispatch({ type: "removeUpload", id: item.id })}>
                      移除
                    </button>
                  ) : null}
                </header>
                {item.check ? (
                  <>
                    <ul className="upload-checks">
                      {item.check.items.map((check) => (
                        <li key={check.label} className={check.ok ? "" : "upload-check--failed"}>
                          <span aria-hidden="true">{check.ok ? "✓" : "✕"}</span>
                          <b>{check.label}</b>
                          <span>{check.detail}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="agent-line"><span>Agent</span>{item.check.note}</p>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

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

      {!locked ? <p className={`inputs-summary${status.ready ? "" : " inputs-summary--blocked"}`}>{summaryText(status)}</p> : null}
    </div>
  );
}

function summaryText(status: ReturnType<typeof inputStatus>): string {
  if (status.checking) return `有 ${status.checking} 份上传数据正在检查，完成后才能开始。`;
  if (status.failed) return `有 ${status.failed} 份上传数据未通过检查，请修改后重新上传，或移除后再开始。`;
  if (status.count < status.min) return `已选 ${status.count} 份数据，至少需要 ${status.min} 份。`;
  return `已选 ${status.count} 份数据，可以开始准入检查。`;
}
