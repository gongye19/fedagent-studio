import type { ChangeEvent, DragEvent } from "react";
import { matchedDatasets } from "../domain/demo";
import { NODE_SETUP, SAMPLE_BYTES, checkUpload, dataContract, isTextFile } from "../domain/inputs";
import type { FrontendRunPlan } from "../domain/plan";
import { PRESET_LABEL, type ExecutionPreset } from "../domain/run";
import { inputStatus, type Action, type State } from "../state/store";
import { StageMessage } from "./common";
import { Icon } from "./icons";

/** Agent 检查、节点上线的演示时长；检查本身在浏览器本地同步完成。 */
const CHECK_DEMO_MS = 900;

const STATUS_TEXT = { checking: "Agent 检查中…", passed: "检查通过", failed: "未通过" } as const;

export default function InputsStep({
  state, plan, dispatch,
}: {
  state: State;
  plan: FrontendRunPlan | null;
  dispatch: (action: Action) => void;
}) {
  const scenario = state.selection.scenario;
  if (!plan || !scenario) return <div className="step-pad"><StageMessage text="先在「配置」里选好场景和协作策略，平台才能确定需要什么数据。" /></div>;

  const locked = Boolean(state.run);
  const contract = dataContract({ ...state.selection, scenario });
  const datasets = matchedDatasets(state.selection);
  const status = inputStatus(state, plan);
  const nodes = plan.input.kind === "nodes";

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
          <span className="badge">至少 {plan.minParticipants} 方</span>
        </header>
        <ul>
          {contract.requirements.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section aria-labelledby="catalog-title">
        <header className="section-head">
          <h3 id="catalog-title">{nodes ? "已连接的节点" : "其他参与方已提交"}（{datasets.length}）</h3>
        </header>
        <p className="section-note">
          {nodes
            ? "勾选参加本次运行的节点。数据留在各节点本地，平台只看到节点上报的摘要。"
            : "勾选参加本次运行的文件。报告里只会出现汇总或合并后的结果。"}
        </p>
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

      {nodes ? (
        <NodeSection
          runner={plan.runner}
          ownNode={state.ownNode}
          locked={locked}
          onConnect={() => {
            dispatch({ type: "connectNode" });
            setTimeout(() => dispatch({ type: "nodeOnline" }), CHECK_DEMO_MS);
          }}
          onDisconnect={() => dispatch({ type: "disconnectNode" })}
        />
      ) : (
        <section aria-labelledby="upload-title">
          <header className="section-head">
            <h3 id="upload-title">上传我方文件</h3>
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
                    <span aria-live="polite" className={`status${item.status === "passed" ? " status--complete" : item.status === "failed" ? " status--failed" : " status--running"}`}>
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
                            <span><Icon name={check.ok ? "check" : "x"} label={check.ok ? "通过" : "未通过"} /></span>
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
      )}

      <section className="run-settings" aria-labelledby="run-settings-title">
        <header className="section-head"><h3 id="run-settings-title">运行设置</h3></header>
        {nodes ? <div className="segmented" role="radiogroup" aria-label="执行预设">
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
        </div> : null}
        <div className="segmented" role="radiogroup" aria-label="运行环境">
          <button type="button" role="radio" aria-checked="true" disabled={locked}>前端模拟</button>
          <button type="button" role="radio" aria-checked="false" disabled title="后端未接入">真实运行 · 后端未接入</button>
        </div>
      </section>

      {!locked ? <p aria-live="polite" className={`inputs-summary${status.ready ? "" : " inputs-summary--blocked"}`}>{summaryText(status, nodes)}</p> : null}
    </div>
  );
}

function summaryText(status: ReturnType<typeof inputStatus>, nodes: boolean): string {
  const unit = nodes ? "个节点" : "份文件";
  if (status.checking) return nodes ? "我方节点正在连接，上线后才能开始。" : `有 ${status.checking} 份文件正在检查，完成后才能开始。`;
  if (status.failed) return `有 ${status.failed} 份文件未通过检查，请修改后重新上传，或移除后再开始。`;
  if (status.count < status.min) return `已选 ${status.count} ${unit}，至少需要 ${status.min} ${unit.slice(0, 1)}。`;
  return `已选 ${status.count} ${unit}，可以开始准入检查。`;
}

function NodeSection({
  runner, ownNode, locked, onConnect, onDisconnect,
}: {
  runner: string;
  ownNode: State["ownNode"];
  locked: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const setup = NODE_SETUP[runner];
  return (
    <section aria-labelledby="node-title">
      <header className="section-head">
        <h3 id="node-title">连接我方节点</h3>
        {ownNode !== "none" ? (
          <span aria-live="polite" className={`status ${ownNode === "online" ? "status--complete" : "status--running"}`}>
            {ownNode === "online" ? "在线" : "连接中…"}
          </span>
        ) : null}
      </header>
      {setup ? (
        <div className="node-setup">
          <ol>
            {setup.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <pre translate="no"><code>{setup.command}</code></pre>
        </div>
      ) : null}
      {!locked ? (
        <div className="node-actions">
          {ownNode === "none" ? (
            <button type="button" className="button button--secondary" onClick={onConnect}>模拟我方节点上线</button>
          ) : ownNode === "online" ? (
            <button type="button" className="button button--secondary" onClick={onDisconnect}>断开我方节点</button>
          ) : null}
          <small>前端模拟：不会真的启动节点。不连我方节点，也可以只用上面已连接的节点运行。</small>
        </div>
      ) : null}
    </section>
  );
}
