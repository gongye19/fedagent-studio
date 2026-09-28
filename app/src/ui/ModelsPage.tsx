import { useState, type Dispatch } from "react";
import { DEFAULT_ENDPOINT_ID, endpointOf, isConfigured, type Endpoint } from "../domain/resources";
import type { Action, State } from "../state/store";
import { PageHead, StatusPill } from "./common";
import { Icon } from "./icons";

type Props = { state: State; dispatch: Dispatch<Action> };

function usedBy(state: State, endpointId: string): number {
  return state.tasks.filter((task) => [task.config.serverModel, ...task.members.map((member) => member.model)]
    .some((ref) => endpointOf(ref, state.endpoints)?.id === endpointId)).length;
}

export default function ModelsPage({ state, dispatch }: Props) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHead
        title="模型接口"
        meta="平台侧的模型调用都走 OpenAI 兼容的 LLM API，密钥只存在服务端；本地参与方用自己的模型，不经过这里。"
        actions={adding ? null : <button type="button" className="button button--secondary" onClick={() => setAdding(true)}><Icon name="plus" />新增接口</button>}
      />
      {adding ? <NewEndpoint state={state} dispatch={dispatch} onDone={() => setAdding(false)} /> : null}
      <div className="endpoint-grid">
        {state.endpoints.map((endpoint) => (
          <EndpointCard key={endpoint.id} endpoint={endpoint} used={usedBy(state, endpoint.id)} dispatch={dispatch} />
        ))}
      </div>
    </>
  );
}

function EndpointCard({ endpoint, used, dispatch }: { endpoint: Endpoint; used: number; dispatch: Dispatch<Action> }) {
  const configured = isConfigured(endpoint);
  const fallback = endpoint.id === DEFAULT_ENDPOINT_ID;
  return (
    <section className="endpoint-card" aria-labelledby={`endpoint-${endpoint.id}`}>
      <header>
        <h2 id={`endpoint-${endpoint.id}`}>{endpoint.name}</h2>
        {configured ? null : <StatusPill tone="warning">待配置</StatusPill>}
      </header>
      <dl className="facts">
        <div><dt>接口地址</dt><dd>{endpoint.baseUrl ? <code>{endpoint.baseUrl}</code> : <span className="muted">接入后端后填写</span>}</dd></div>
        <div>
          <dt>模型</dt>
          <dd>
            {endpoint.models.length
              ? <ul className="chips">{endpoint.models.map((model) => <li key={model}><code>{model}</code></li>)}</ul>
              : <span className="muted">接入后端后填写</span>}
          </dd>
        </div>
        <div><dt>使用</dt><dd>{used ? `${used} 个任务${fallback ? "（没有单独指定模型的调用都走这里）" : ""}` : "暂未使用"}</dd></div>
      </dl>
      <div className="form-grid form-grid--tight">
        <label className="field">
          <span>并发上限</span>
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
        <label className="field">
          <span>单价（元 / 百万 token）</span>
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
      <p className="section-meta">单价用于新建任务时的费用预估。接入后端后可以测试连通。</p>
    </section>
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
    <section className="form-card" aria-labelledby="new-endpoint-title">
      <h2 id="new-endpoint-title">新增接口</h2>
      <div className="form-grid">
        <label className="field">
          <span>名称</span>
          <input value={name} maxLength={30} onChange={(event) => setName(event.target.value)} placeholder="例如：实验室模型服务" />
        </label>
        <label className="field">
          <span>接口地址</span>
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://…/v1" aria-invalid={baseUrl !== "" && !validUrl} />
          {baseUrl !== "" && !validUrl ? <span className="field-error">以 http:// 或 https:// 开头</span> : null}
        </label>
        <label className="field field--wide">
          <span>模型（每行一个，或用逗号分隔）</span>
          <textarea rows={3} value={models} onChange={(event) => setModels(event.target.value)} placeholder="模型名称" />
        </label>
        <label className="field">
          <span>并发上限</span>
          <input type="number" min={1} max={256} value={concurrency} onChange={(event) => setConcurrency(Math.max(1, Math.min(256, Number.parseInt(event.target.value, 10) || 1)))} />
        </label>
        <label className="field">
          <span>API 密钥</span>
          <input type="password" disabled placeholder="接入后端后填写，只保存在服务端" />
        </label>
      </div>
      <div className="form-actions">
        <button type="button" className="button button--secondary" onClick={onDone}>取消</button>
        <button type="button" className="button button--primary" disabled={!ready} onClick={save}>保存</button>
      </div>
    </section>
  );
}
