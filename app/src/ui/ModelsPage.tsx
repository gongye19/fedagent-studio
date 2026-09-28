import { useState, type Dispatch } from "react";
import { DEFAULT_ENDPOINT_ID, endpointOf, isConfigured, type Endpoint } from "../domain/resources";
import type { Action, State } from "../state/store";
import { PageHead, Tag } from "./common";
import { Icon } from "./icons";

type Props = { state: State; dispatch: Dispatch<Action> };

function usedBy(state: State, endpointId: string): number {
  return state.tasks.filter((task) => [task.config.serverModel, ...task.members.map((member) => member.model)]
    .some((ref) => endpointOf(ref, state.endpoints)?.id === endpointId)).length;
}

/** 和"参与方与数据"页一样：列表用表格，新增和编辑共用上方的表单。 */
export default function ModelsPage({ state, dispatch }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const current = editing ? state.endpoints.find((endpoint) => endpoint.id === editing) : undefined;

  return (
    <>
      <PageHead
        title="模型接口"
        meta="平台托管的参与方和服务端通过这里调用模型（OpenAI 兼容接口），密钥只保存在服务端；本地参与方用自己的模型。"
        actions={editing ? null : <button type="button" className="button button--primary" onClick={() => setEditing("new")}><Icon name="plus" />新增接口</button>}
      />
      {editing ? <EndpointForm key={editing} state={state} dispatch={dispatch} endpoint={current} onDone={() => setEditing(null)} /> : null}
      <div className="table-shell">
        <table className="table table--stack">
          <thead>
            <tr>
              <th scope="col">接口</th>
              <th scope="col">模型</th>
              <th scope="col" className="numeric">并发上限</th>
              <th scope="col" className="numeric">单价</th>
              <th scope="col" className="numeric">使用</th>
              <th scope="col" className="numeric"><span className="visually-hidden">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {state.endpoints.map((endpoint) => {
              const used = usedBy(state, endpoint.id);
              return (
                <tr key={endpoint.id}>
                  <th scope="row">
                    <span className="cell-title">
                      {endpoint.name}
                      {isConfigured(endpoint) ? null : <Tag tone="warning">待配置</Tag>}
                    </span>
                    <small>{endpoint.baseUrl ? <code>{endpoint.baseUrl}</code> : "接口地址未填写"}</small>
                  </th>
                  <td data-label="模型">
                    {endpoint.models.length
                      ? <ul className="chips">{endpoint.models.map((model) => <li key={model}>{model}</li>)}</ul>
                      : <span className="muted">未填写</span>}
                  </td>
                  <td className="numeric" data-label="并发上限">{endpoint.concurrency}</td>
                  <td className="numeric" data-label="单价">{endpoint.price === null ? <span className="muted">未设置</span> : `${endpoint.price} 元 / 百万 token`}</td>
                  <td className="numeric" data-label="使用">{used ? `${used} 个任务` : "—"}</td>
                  <td className="numeric">
                    <button type="button" className="button button--secondary button--compact" disabled={editing !== null} onClick={() => setEditing(endpoint.id)}>编辑</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="section-meta">没有单独指定模型的调用都走"默认 LLM 接口"。单价用于新建任务时的费用预估。</p>
    </>
  );
}

function EndpointForm({ state, dispatch, endpoint, onDone }: Props & { endpoint?: Endpoint; onDone: () => void }) {
  const [name, setName] = useState(endpoint?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(endpoint?.baseUrl ?? "");
  const [models, setModels] = useState(endpoint?.models.join("\n") ?? "");
  const [concurrency, setConcurrency] = useState(endpoint?.concurrency ?? 8);
  const [price, setPrice] = useState(endpoint?.price === null || endpoint?.price === undefined ? "" : String(endpoint.price));
  const list = models.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
  const validUrl = baseUrl.trim() === "" || /^https?:\/\/\S+$/.test(baseUrl.trim());
  const priceValue = price.trim() === "" ? null : Number(price);
  const validPrice = priceValue === null || (Number.isFinite(priceValue) && priceValue >= 0);
  const ready = name.trim() !== "" && validUrl && validPrice;

  function save() {
    if (!ready) return;
    const fields = { name: name.trim(), baseUrl: baseUrl.trim(), models: list, concurrency, price: priceValue };
    if (endpoint) {
      dispatch({ type: "updateEndpoint", id: endpoint.id, patch: fields });
    } else {
      const base = fields.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "endpoint";
      let id = base;
      for (let index = 2; state.endpoints.some((item) => item.id === id) || id === DEFAULT_ENDPOINT_ID; index += 1) id = `${base}-${index}`;
      dispatch({ type: "addEndpoint", endpoint: { id, ...fields } });
    }
    onDone();
  }

  return (
    <section className="card" aria-labelledby="endpoint-form-title">
      <h2 id="endpoint-form-title">{endpoint ? `编辑“${endpoint.name}”` : "新增接口"}</h2>
      <div className="form-grid">
        <label className="field">
          <span>名称</span>
          <input value={name} maxLength={30} onChange={(event) => setName(event.target.value)} placeholder="例如：实验室模型服务" />
        </label>
        <label className="field">
          <span>接口地址</span>
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://…/v1" aria-invalid={!validUrl} />
          {validUrl ? <small className="field-hint">OpenAI 兼容接口的 base URL，可以先留空</small> : <span className="field-error">以 http:// 或 https:// 开头</span>}
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
          <span>单价（元 / 百万 token）</span>
          <input type="number" min={0} step="0.1" value={price} placeholder="未设置" aria-invalid={!validPrice} onChange={(event) => setPrice(event.target.value)} />
          <small className="field-hint">用于新建任务时的费用预估</small>
        </label>
        <label className="field field--wide">
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
