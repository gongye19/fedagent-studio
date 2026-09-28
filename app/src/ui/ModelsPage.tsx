import { useState, type Dispatch } from "react";
import { parseModelRef, type Endpoint } from "../domain/resources";
import type { Action, State } from "../state/store";
import { Badge, Note, PageHead, Panel } from "./common";
import { Icon } from "./icons";

type Props = { state: State; dispatch: Dispatch<Action> };

function usedBy(state: State, endpointId: string): number {
  return state.tasks.filter((task) => [task.config.serverModel, ...task.members.map((member) => member.model)]
    .some((ref) => parseModelRef(ref)?.endpointId === endpointId)).length;
}

export default function ModelsPage({ state, dispatch }: Props) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHead
        title="模型接口"
        meta="参与方和服务端的所有模型调用都经过模型网关，使用这里配置的 OpenAI 兼容接口。"
        actions={adding ? null : <button type="button" className="button button--primary" onClick={() => setAdding(true)}><Icon name="plus" />新增接口</button>}
      />
      {adding ? <NewEndpoint state={state} dispatch={dispatch} onDone={() => setAdding(false)} /> : null}
      <div className="endpoint-grid">
        {state.endpoints.map((endpoint) => (
          <EndpointCard key={endpoint.id} endpoint={endpoint} used={usedBy(state, endpoint.id)} dispatch={dispatch} />
        ))}
      </div>
      <Note>API 密钥只保存在服务端，前端原型不保存密钥。单价用于新建任务时的费用预估；本地参与方用自己的模型密钥，不经过这里。</Note>
    </>
  );
}

function EndpointCard({ endpoint, used, dispatch }: { endpoint: Endpoint; used: number; dispatch: Dispatch<Action> }) {
  return (
    <Panel
      title={endpoint.name}
      id={`endpoint-${endpoint.id}`}
      extra={<Badge>未测试</Badge>}
    >
      <dl className="facts">
        <div><dt>接口地址</dt><dd><code>{endpoint.baseUrl}</code></dd></div>
        <div>
          <dt>模型</dt>
          <dd><ul className="chips">{endpoint.models.map((model) => <li key={model}><code>{model}</code></li>)}</ul></dd>
        </div>
        <div><dt>任务使用</dt><dd>{used ? `${used} 个任务` : "暂未使用"}</dd></div>
      </dl>
      <div className="form-grid form-grid--tight">
        <label className="setting">
          <span className="setting-label">并发上限</span>
          <input
            type="number"
            min={1}
            max={256}
            value={endpoint.concurrency}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(value) && value > 0) dispatch({ type: "updateEndpoint", id: endpoint.id, patch: { concurrency: Math.min(256, value) } });
            }}
          />
        </label>
        <label className="setting">
          <span className="setting-label">单价（元 / 百万 token）</span>
          <input
            type="number"
            min={0}
            step="0.1"
            value={endpoint.price ?? ""}
            placeholder="未设置"
            onChange={(event) => {
              const value = event.target.value === "" ? null : Number(event.target.value);
              if (value === null || (Number.isFinite(value) && value >= 0)) dispatch({ type: "updateEndpoint", id: endpoint.id, patch: { price: value } });
            }}
          />
        </label>
      </div>
      <div className="detail-actions">
        <button type="button" className="button button--secondary button--compact" disabled title="接入后端后可用">测试连通</button>
      </div>
    </Panel>
  );
}

function NewEndpoint({ state, dispatch, onDone }: Props & { onDone: () => void }) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState("");
  const [concurrency, setConcurrency] = useState(8);
  const list = models.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
  const validUrl = /^https?:\/\/\S+$/.test(baseUrl.trim());
  const ready = name.trim() && validUrl && list.length > 0;

  function save() {
    if (!ready) return;
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "endpoint";
    let id = base;
    for (let index = 2; state.endpoints.some((endpoint) => endpoint.id === id); index += 1) id = `${base}-${index}`;
    dispatch({ type: "addEndpoint", endpoint: { id, name: name.trim(), baseUrl: baseUrl.trim(), models: list, concurrency, price: null } });
    onDone();
  }

  return (
    <Panel title="新增接口" id="new-endpoint">
      <div className="form-grid">
        <label className="setting">
          <span className="setting-label">名称</span>
          <input value={name} maxLength={30} onChange={(event) => setName(event.target.value)} placeholder="例如：实验室 vLLM" />
        </label>
        <label className="setting">
          <span className="setting-label">接口地址</span>
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://…/v1" aria-invalid={baseUrl !== "" && !validUrl} />
          {baseUrl !== "" && !validUrl ? <small className="setting-error">以 http:// 或 https:// 开头</small> : null}
        </label>
        <label className="setting setting--wide">
          <span className="setting-label">模型（每行一个，或用逗号分隔）</span>
          <textarea rows={3} value={models} onChange={(event) => setModels(event.target.value)} placeholder="deepseek/deepseek-chat" />
        </label>
        <label className="setting">
          <span className="setting-label">并发上限</span>
          <input type="number" min={1} max={256} value={concurrency} onChange={(event) => setConcurrency(Math.max(1, Math.min(256, Number.parseInt(event.target.value, 10) || 1)))} />
        </label>
        <label className="setting">
          <span className="setting-label">API 密钥</span>
          <input type="password" disabled placeholder="接入后端后填写，只保存在服务端" />
        </label>
      </div>
      <div className="form-actions">
        <button type="button" className="button button--secondary" onClick={onDone}>取消</button>
        <button type="button" className="button button--primary" disabled={!ready} onClick={save}>保存</button>
      </div>
    </Panel>
  );
}
