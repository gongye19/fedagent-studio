import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { components } from "../api/schema";
import { DEFAULT_ENDPOINT_ID, type Endpoint } from "../domain/resources";
import { deleteEndpoint, saveEndpoint } from "../state/actions";
import { showFlash } from "../state/flash";
import { backTo, navigate, type From } from "../state/route";
import type { State } from "../state/store";
import { Confirm, FormActions, NotFound, Notice, PageHead } from "./common";
import { Field, FieldGroup, Panel, UnitInput } from "./console";
import { Icon } from "./icons";

type Check = components["schemas"]["EndpointTestOut"];

type Props = { state: State; id?: string; from?: From };

/**
 * 新增或编辑模型接口（OpenAI 兼容），独立页面。接口地址和模型都要填：没有它们，新建任务时选不到这个接口的模型。
 * API 密钥交给后端加密保存，只能写入、不能读出；前端不保存，编辑时留空表示不修改。
 */
export default function EndpointPage({ state, id, from }: Props) {
  const endpoint = id ? state.endpoints.find((item) => item.id === id) : undefined;
  if (id && (!endpoint || endpoint.kind === "fake")) return <NotFound kind="接口" back={{ page: "models" }} backLabel="模型接口" />;
  return <EndpointForm key={id ?? "new"} state={state} endpoint={endpoint} from={from} />;
}

function EndpointForm({ state, endpoint, from }: { state: State; endpoint?: Endpoint; from?: From }) {
  const [name, setName] = useState(endpoint?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(endpoint?.baseUrl ?? "");
  const [models, setModels] = useState(endpoint?.models.join(", ") ?? "");
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [concurrency, setConcurrency] = useState(endpoint?.concurrency ?? 8);
  const [price, setPrice] = useState(endpoint?.price === null || endpoint?.price === undefined ? "" : String(endpoint.price));
  const [removing, setRemoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<Check | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const list = models.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
  const url = baseUrl.trim();
  const validUrl = url === "" || /^https?:\/\/\S+$/.test(url);
  const priceValue = price.trim() === "" ? null : Number(price);
  const validPrice = priceValue === null || (Number.isFinite(priceValue) && priceValue >= 0);
  const missing = [
    name.trim() ? null : "名称",
    url === "" ? "接口地址" : validUrl ? null : "正确的接口地址",
    list.length ? null : "模型",
    validPrice ? null : "正确的单价",
  ].filter((item): item is string => Boolean(item));
  const back = backTo(from, { page: "models" }, state.draft.scenario);
  const title = endpoint ? `编辑“${endpoint.name}”` : "新增接口";

  async function save() {
    if (missing.length) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveEndpoint(endpoint?.id ?? null, {
        name: name.trim(),
        baseUrl: url,
        models: list,
        concurrency,
        price: priceValue,
        // 留空：不修改已保存的密钥；勾了清除：清掉
        apiKey: clearKey ? "" : apiKey.trim() ? apiKey.trim() : null,
        timeout: endpoint?.timeout ?? 600,
        maxRetries: endpoint?.maxRetries ?? 8,
      });
      showFlash(back, endpoint ? `已保存“${saved.name}”。` : `已添加“${saved.name}”，新建任务时可以选它的模型。`);
      navigate(back);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "保存失败，稍后再试");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!endpoint) return;
    try {
      await deleteEndpoint(endpoint.id);
      showFlash({ page: "models" }, `已删除“${endpoint.name}”。`);
      navigate({ page: "models" });
    } catch (failure) {
      setRemoving(false);
      setError(failure instanceof ApiError ? failure.message : "删除失败，稍后再试");
    }
  }

  async function test() {
    if (!endpoint) return;
    setTesting(true);
    setTested(null);
    setTestError(null);
    try {
      setTested(await api.testEndpoint(endpoint.id));
    } catch (failure) {
      setTestError(failure instanceof ApiError ? failure.message : "测试失败，稍后再试");
    } finally {
      setTesting(false);
    }
  }

  // 接口提供的模型点一下就加进"模型"，保存后生效
  function addModel(model: string) {
    setModels((current) => (current.trim() ? `${current.trim().replace(/[,，]$/, "")}, ${model}` : model));
  }

  const deletable = endpoint && endpoint.id !== DEFAULT_ENDPOINT_ID && !endpoint.builtin;
  const actions = endpoint && !removing ? (
    <>
      {endpoint.configured ? <button type="button" className="button button--secondary" disabled={testing} onClick={() => void test()}>{testing ? "正在测试…" : "测试连接"}</button> : null}
      {deletable ? <button type="button" className="button button--secondary button--danger" onClick={() => setRemoving(true)}>删除接口</button> : null}
    </>
  ) : null;
  return (
    <>
      <PageHead title={title} crumbs={[{ label: "模型接口", route: { page: "models" } }]} actions={actions} />
      {testError ? <Notice tone="warning" onDismiss={() => setTestError(null)}>{`测试失败：${testError}`}</Notice> : null}
      {removing && endpoint ? (
        <Confirm title={`删除“${endpoint.name}”？`} confirmLabel="删除" onConfirm={() => void remove()} onCancel={() => setRemoving(false)}>
          已有任务的配置不受影响；新建任务时不能再选它的模型。
        </Confirm>
      ) : null}
      <div className="form-page">
        {tested ? <CheckPanel result={tested} listed={list} onAdd={addModel} onClose={() => setTested(null)} /> : null}
        <Panel title="接口设置">
          <div className="form-body">
            <FieldGroup>
              <Field label="名称" htmlFor="endpoint-name">
                <input id="endpoint-name" name="endpoint-name" autoComplete="off" value={name} maxLength={30} onChange={(event) => setName(event.target.value)} placeholder="例如：实验室模型服务" />
              </Field>
              <Field label="模型" htmlFor="endpoint-models">
                <input id="endpoint-models" name="endpoint-models" autoComplete="off" spellCheck={false} value={models} onChange={(event) => setModels(event.target.value)} placeholder="例如：model-a, model-b" />
              </Field>
              <Field label="接口地址" htmlFor="endpoint-url" error={validUrl ? undefined : "地址要以 http:// 或 https:// 开头"}>
                <input id="endpoint-url" name="endpoint-url" type="url" inputMode="url" autoComplete="off" spellCheck={false} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="OpenAI 兼容地址，例如 https://…/v1" aria-invalid={!validUrl} aria-describedby={validUrl ? undefined : "endpoint-url-error"} />
              </Field>
              <Field label="API 密钥" optional htmlFor="endpoint-key">
                <input
                  id="endpoint-key"
                  name="endpoint-key"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={apiKey}
                  disabled={clearKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={endpoint?.hasKey ? "已保存，留空表示不修改" : "加密保存在服务端，不会再显示"}
                />
              </Field>
              <Field label="并发上限" htmlFor="endpoint-concurrency">
                <input id="endpoint-concurrency" name="endpoint-concurrency" type="number" inputMode="numeric" autoComplete="off" min={1} max={256} value={concurrency} onChange={(event) => setConcurrency(Math.max(1, Math.min(256, Number.parseInt(event.target.value, 10) || 1)))} />
              </Field>
              <Field label="单价" optional htmlFor="endpoint-price" error={validPrice ? undefined : "单价不能小于 0"}>
                <UnitInput id="endpoint-price" unit="元 / 百万 token" name="endpoint-price" type="number" inputMode="decimal" autoComplete="off" min={0} step="0.1" value={price} placeholder="未设置" aria-invalid={!validPrice} aria-describedby={validPrice ? undefined : "endpoint-price-error"} onChange={(event) => setPrice(event.target.value)} />
              </Field>
              {endpoint?.hasKey ? (
                <Field label="已保存的密钥" htmlFor="endpoint-clear-key">
                  <label className="check-line">
                    <input id="endpoint-clear-key" name="endpoint-clear-key" type="checkbox" checked={clearKey} onChange={(event) => setClearKey(event.target.checked)} />
                    保存时清除
                  </label>
                </Field>
              ) : null}
            </FieldGroup>
          </div>
        </Panel>
        <FormActions missing={missing} saving={saving} error={error} saveLabel={endpoint ? "保存修改" : "保存接口"} onCancel={() => navigate(back)} onSave={() => void save()} />
      </div>
    </>
  );
}

/**
 * 测试连接的结果：每个登记的模型按任务实际会用的生成参数各发一条很短的请求；
 * 接口提供、还没登记的模型点一下加进"模型"。
 */
function CheckPanel({ result, listed, onAdd, onClose }: { result: Check; listed: readonly string[]; onAdd: (model: string) => void; onClose: () => void }) {
  const available = result.available;
  const unlisted = available ? available.filter((model) => !listed.includes(model)) : [];
  const missing = available ? result.checks.map((check) => check.model).filter((model) => !available.includes(model)) : [];
  return (
    <Panel
      title="检查结果"
      extra={result.ok ? "模型都能用" : "有模型不能用"}
      actions={<button type="button" className="button button--secondary button--compact" onClick={onClose}>收起</button>}
      flush
    >
      <table className="table">
        <caption className="visually-hidden">每个模型按任务实际的参数各试一次的结果</caption>
        <thead>
          <tr>
            <th scope="col">模型</th>
            <th scope="col">结果</th>
            <th scope="col" className="numeric">耗时</th>
          </tr>
        </thead>
        <tbody>
          {result.checks.map((check) => (
            <tr key={check.model}>
              {/* 模型名不能从中间断开 */}
              <th scope="row" className="nowrap">{check.model}</th>
              <td>{check.ok ? <span className="status-text">正常</span> : <span className="check-error">{check.message}</span>}</td>
              <td className="numeric nowrap">{latencyText(check.latencyMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="model-picks">
        {available === null || available === undefined ? <span>读不到接口的模型列表{result.modelsError ? `：${result.modelsError}` : ""}</span> : (
          <>
            <span>{unlisted.length ? `接口还提供 ${unlisted.length} 个模型，点击加入：` : `接口提供的 ${available.length} 个模型都已登记`}</span>
            {unlisted.map((model) => (
              <button key={model} type="button" className="button button--secondary button--compact" onClick={() => onAdd(model)}>
                <Icon name="plus" />{model}
              </button>
            ))}
          </>
        )}
        {missing.length ? <span className="check-error">接口的模型列表里没有：{missing.join("、")}</span> : null}
      </div>
    </Panel>
  );
}

function latencyText(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
}
