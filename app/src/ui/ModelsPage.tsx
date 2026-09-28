import { useState, type Dispatch } from "react";
import { DEFAULT_ENDPOINT_ID, endpointOf, isConfigured, type Endpoint } from "../domain/resources";
import type { Action, State } from "../state/store";
import { FormActions, Meta, Notice, PageHead, Tag } from "./common";
import { Icon } from "./icons";

type Props = { state: State; dispatch: Dispatch<Action> };

function usedBy(state: State, endpointId: string): number {
  return state.tasks.filter((task) => [task.config.serverModel, ...task.members.map((member) => member.model)]
    .some((ref) => endpointOf(ref, state.endpoints)?.id === endpointId)).length;
}

/** 和"参与方与数据"页一样：列表用表格，新增和编辑共用上方的表单。 */
export default function ModelsPage({ state, dispatch }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const current = editing ? state.endpoints.find((endpoint) => endpoint.id === editing) : undefined;

  function open(id: string) {
    setSaved(null);
    setEditing(id);
  }

  return (
    <>
      <PageHead
        title="模型接口"
        meta="平台托管的参与方和服务端通过这里调用模型；本地参与方用自己的模型。"
        actions={editing ? null : <button type="button" className="button button--primary" onClick={() => open("new")}><Icon name="plus" />新增接口</button>}
      />
      {saved ? <Notice action={<button type="button" className="link-button" onClick={() => setSaved(null)}>知道了</button>}>{saved}</Notice> : null}
      {editing ? (
        <EndpointForm
          key={editing}
          state={state}
          dispatch={dispatch}
          endpoint={current}
          onDone={(message) => {
            setEditing(null);
            if (message) setSaved(message);
          }}
        />
      ) : null}
      <div className="table-shell">
        <table className="table table--stack">
          <thead>
            <tr>
              <th scope="col">接口</th>
              <th scope="col">模型</th>
              <th scope="col" className="numeric">并发上限</th>
              <th scope="col" className="numeric">单价（元 / 百万 token）</th>
              <th scope="col" className="numeric">使用</th>
              <th scope="col" className="numeric"><span className="visually-hidden">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {state.endpoints.map((endpoint) => {
              const used = usedBy(state, endpoint.id);
              const fallback = endpoint.id === DEFAULT_ENDPOINT_ID;
              return (
                <tr key={endpoint.id}>
                  <th scope="row">
                    <span className="cell-title">
                      {endpoint.name}
                      {isConfigured(endpoint) ? null : <Tag tone="warning">待配置</Tag>}
                    </span>
                    {endpoint.baseUrl || fallback ? (
                      <small>
                        <Meta parts={[endpoint.baseUrl ? <code key="url">{endpoint.baseUrl}</code> : null, fallback ? "未指定模型的调用都走这里" : null]} />
                      </small>
                    ) : null}
                  </th>
                  <td data-label="模型">{endpoint.models.length ? endpoint.models.join("、") : "—"}</td>
                  <td className="numeric" data-label="并发上限">{endpoint.concurrency}</td>
                  <td className="numeric" data-label="单价（元 / 百万 token）">{endpoint.price === null ? "—" : endpoint.price}</td>
                  <td className="numeric" data-label="使用">{used ? `${used} 个任务` : "—"}</td>
                  <td className="numeric cell-action">
                    <button type="button" className="button button--secondary button--compact" disabled={editing !== null} onClick={() => open(endpoint.id)}>编辑</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EndpointForm({ state, dispatch, endpoint, onDone }: Props & { endpoint?: Endpoint; onDone: (message?: string) => void }) {
  const [name, setName] = useState(endpoint?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(endpoint?.baseUrl ?? "");
  const [models, setModels] = useState(endpoint?.models.join("\n") ?? "");
  const [concurrency, setConcurrency] = useState(endpoint?.concurrency ?? 8);
  const [price, setPrice] = useState(endpoint?.price === null || endpoint?.price === undefined ? "" : String(endpoint.price));
  const list = models.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
  const validUrl = baseUrl.trim() === "" || /^https?:\/\/\S+$/.test(baseUrl.trim());
  const priceValue = price.trim() === "" ? null : Number(price);
  const validPrice = priceValue === null || (Number.isFinite(priceValue) && priceValue >= 0);
  const missing = [
    name.trim() ? null : "名称",
    validUrl ? null : "正确的接口地址",
    validPrice ? null : "正确的单价",
  ].filter((item): item is string => Boolean(item));

  function save() {
    if (missing.length) return;
    const fields = { name: name.trim(), baseUrl: baseUrl.trim(), models: list, concurrency, price: priceValue };
    if (endpoint) {
      dispatch({ type: "updateEndpoint", id: endpoint.id, patch: fields });
      onDone(`已保存“${fields.name}”。`);
      return;
    }
    const base = fields.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "endpoint";
    let id = base;
    for (let index = 2; state.endpoints.some((item) => item.id === id) || id === DEFAULT_ENDPOINT_ID; index += 1) id = `${base}-${index}`;
    dispatch({ type: "addEndpoint", endpoint: { id, ...fields } });
    onDone(`已添加“${fields.name}”，新建任务时可以在模型下拉里选它的模型。`);
  }

  return (
    <section className="card" aria-labelledby="endpoint-form-title">
      <h2 id="endpoint-form-title">{endpoint ? `编辑“${endpoint.name}”` : "新增接口"}</h2>
      <div className="form-grid">
        <label className="field">
          <span>名称</span>
          <input name="endpoint-name" autoComplete="off" value={name} maxLength={30} onChange={(event) => setName(event.target.value)} placeholder="例如：实验室模型服务" />
        </label>
        <label className="field">
          <span>接口地址（可不填）</span>
          <input name="endpoint-url" type="url" inputMode="url" autoComplete="off" spellCheck={false} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://…/v1" aria-invalid={!validUrl} aria-describedby="endpoint-url-note" />
          {validUrl
            ? <small id="endpoint-url-note" className="field-hint">OpenAI 兼容接口的地址；留空则保持“待配置”</small>
            : <small id="endpoint-url-note" className="field-error">地址要以 http:// 或 https:// 开头</small>}
        </label>
        <label className="field field--wide">
          <span>模型（可不填）</span>
          <textarea name="endpoint-models" autoComplete="off" spellCheck={false} rows={3} value={models} onChange={(event) => setModels(event.target.value)} placeholder="每行一个模型名，或用逗号分隔…" />
        </label>
        <label className="field">
          <span>并发上限</span>
          <input name="endpoint-concurrency" type="number" inputMode="numeric" autoComplete="off" min={1} max={256} value={concurrency} onChange={(event) => setConcurrency(Math.max(1, Math.min(256, Number.parseInt(event.target.value, 10) || 1)))} />
        </label>
        <label className="field">
          <span>单价（元 / 百万 token，可不填）</span>
          <input name="endpoint-price" type="number" inputMode="decimal" autoComplete="off" min={0} step="0.1" value={price} placeholder="未设置" aria-invalid={!validPrice} aria-describedby="endpoint-price-note" onChange={(event) => setPrice(event.target.value)} />
          {validPrice
            ? <small id="endpoint-price-note" className="field-hint">用于新建任务时的费用预估</small>
            : <small id="endpoint-price-note" className="field-error">单价不能小于 0</small>}
        </label>
        <div className="field field--wide">
          <span>API 密钥</span>
          <p className="field-static">接入后端后在服务端填写，前端不保存密钥。</p>
        </div>
      </div>
      <FormActions missing={missing} saveLabel={endpoint ? "保存修改" : "保存接口"} onCancel={() => onDone()} onSave={save} />
    </section>
  );
}
