import { SelectField } from "./SelectField";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api, ApiError } from "../api/client";
import type { components } from "../api/schema";
import { DEFAULT_ENDPOINT_ID, type Endpoint } from "../domain/resources";
import { deleteEndpoint, saveEndpoint } from "../state/actions";
import { showFlash } from "../state/flash";
import { backTo, navigate, type From } from "../state/route";
import type { State } from "../state/store";
import { Confirm, FormActions, NotFound, PageHead } from "./common";
import { Field, FieldGroup, Panel, UnitInput } from "./console";
import { useDebounced } from "./hooks";
import { CheckRows } from "./CheckStatus";
import { keys, queryClient } from "../state/server";

type Check = components["schemas"]["EndpointTestOut"];

type Props = { state: State; id?: string; from?: From };

/**
 * 新增或编辑模型接口（OpenAI 兼容），独立页面。每个接口选用一个模型：填好地址和密钥后，从接口提供的模型里选；
 * 接口不提供模型列表时直接填模型名。要用同一家的另一个模型，就再登记一个接口。
 * API 密钥交给后端加密保存，只能写入、不能读出；前端不保存，编辑时留空表示不修改。
 */
export default function EndpointPage({ state, id, from }: Props) {
  const endpoint = id ? state.endpoints.find((item) => item.id === id) : undefined;
  if (id && (!endpoint || endpoint.kind === "fake")) return <NotFound kind="接口" back={{ page: "models" }} backLabel="LLM 接口" />;
  return <EndpointForm key={id ?? "new"} state={state} endpoint={endpoint} from={from} />;
}

export function EndpointForm({ state, endpoint, from, onSaved, onCancel, onBusyChange }: {
  state: State; endpoint?: Endpoint; from?: From; onSaved?: (endpoint: Endpoint) => void; onCancel?: () => void;
  onBusyChange?: (value: boolean) => void;
}) {
  const [name, setName] = useState(endpoint?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(endpoint?.baseUrl ?? "");
  const [model, setModel] = useState(endpoint?.models[0] ?? "");
  const [apiKey, setApiKey] = useState("");
  const [keyRevision, setKeyRevision] = useState(0);
  const formId = useId();
  const [clearKey, setClearKey] = useState(false);
  const [concurrency, setConcurrency] = useState(endpoint?.concurrency ?? 8);
  const [price, setPrice] = useState(endpoint?.price === null || endpoint?.price === undefined ? "" : String(endpoint.price));
  const [removing, setRemoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState(endpoint?.id);
  const [tested, setTested] = useState<Check | null>(null);

  const url = baseUrl.trim();
  const validUrl = url === "" || /^https?:\/\/\S+$/.test(url);
  // 接口提供的模型：地址、密钥停下 0.5 秒后读一次；没填密钥时用已经保存的
  const listRequest = useDebounced({ baseUrl: url, apiKey: clearKey ? "" : apiKey.trim() || null, endpointId: endpoint?.id ?? null, keyRevision, clearKey }, 500);
  const available = useQuery({
    // 密钥不能进入查询键，离开表单时销毁请求闭包。
    queryKey: ["endpoint-models", formId, listRequest.baseUrl, listRequest.endpointId, listRequest.keyRevision, listRequest.clearKey],
    queryFn: () => api.previewModels(listRequest),
    enabled: listRequest.baseUrl !== "" && /^https?:\/\/\S+$/.test(listRequest.baseUrl),
    retry: false,
    staleTime: 60_000,
    gcTime: 0,
  });
  const choices = available.data?.models ?? [];
  const listError = available.error ? (available.error instanceof ApiError ? available.error.message : "读不到模型列表") : null;
  const priceValue = price.trim() === "" ? null : Number(price);
  const validPrice = priceValue === null || (Number.isFinite(priceValue) && priceValue >= 0);
  const missing = [
    name.trim() ? null : "名称",
    url === "" ? "接口地址" : validUrl ? null : "正确的接口地址",
    model.trim() ? null : "模型",
    validPrice ? null : "正确的单价",
  ].filter((item): item is string => Boolean(item));
  const back = backTo(from, { page: "models", space: endpoint?.resourceSpace ?? "workspace" }, state.draft.scenario);
  const title = endpoint ? `编辑“${endpoint.name}”` : "新增接口";

  async function save() {
    if (missing.length || saving) return;
    setSaving(true);
    onBusyChange?.(true);
    setError(null);
    try {
      const saved = await saveEndpoint(savedId ?? null, {
        name: name.trim(),
        baseUrl: url,
        models: [model.trim()],
        concurrency,
        price: priceValue,
        // 留空：不修改已保存的密钥；勾了清除：清掉
        apiKey: clearKey ? "" : apiKey.trim() ? apiKey.trim() : null,
        timeout: endpoint?.timeout ?? 600,
        maxRetries: endpoint?.maxRetries ?? 8,
      });
      setSavedId(saved.id);
      if (!saved.verified) {
        const checked = await api.testEndpoint(saved.id);
        setTested(checked);
        if (!checked.ok) { if (!checked.checks.length) setError(checked.message); return; }
      }
      const current = (await api.endpoints()).find((e) => e.id === saved.id);
      if (!current?.verified) throw new Error("接口已变化，请重新验证");
      await queryClient.invalidateQueries({queryKey: keys.endpoints});
      if (onSaved) {onSaved(current);return;}
      showFlash(back, `已保存“${saved.name}”。`);
      navigate(back);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "保存失败，稍后再试");
    } finally {
      setSaving(false);
      onBusyChange?.(false);
    }
  }

  async function remove() {
    if (!endpoint) return;
    await deleteEndpoint(endpoint.id);
    showFlash(back, `已删除“${endpoint.name}”。`);
    navigate(back);
  }

  const deletable = endpoint && endpoint.id !== DEFAULT_ENDPOINT_ID && !endpoint.builtin;
  const actions = endpoint ? (
    <>
      {deletable ? <button type="button" className="button button--secondary button--danger" disabled={saving} onClick={() => setRemoving(true)}>删除接口</button> : null}
    </>
  ) : null;
  return (
    <>
      {!onSaved ? <PageHead title={title} back={{ label: from === "newTask" ? "任务配置" : "LLM 接口", route: back }} actions={actions} /> : null}
      {removing && endpoint ? (
        <Confirm title={`删除“${endpoint.name}”？`} confirmLabel="删除" onConfirm={() => remove()} onCancel={() => setRemoving(false)}>
          排队、运行或暂停的任务使用此接口时不能删除；删除后，新建任务不能再选它的模型。
        </Confirm>
      ) : null}
      <div className="form-page">

        <Panel title="接口设置">
          <div className="form-body" inert={saving}>
            <FieldGroup>
              <Field label="名称" htmlFor="endpoint-name">
                <input id="endpoint-name" name="endpoint-name" autoComplete="off" value={name} maxLength={30} onChange={(event) => setName(event.target.value)} placeholder="例如：实验室模型服务" />
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
                  onChange={(event) => { setApiKey(event.target.value); setKeyRevision((value) => value + 1); }}
                  placeholder={endpoint?.hasKey ? "已保存，留空表示不修改" : "加密保存在服务端，不会再显示"}
                />
              </Field>
              {/* 从接口提供的模型里选；接口不提供模型列表时直接填 */}
              <Field label="模型" htmlFor="endpoint-model" error={listError && !choices.length ? `${listError}，可以直接填模型名` : undefined}>
                {choices.length ? (
                  <SelectField id="endpoint-model" name="endpoint-model" value={model} onValueChange={(value) => setModel(value)}>
                    {model ? null : <option value="">选择模型</option>}
                    {model && !choices.includes(model) ? <option value={model}>{model}（不在接口的模型列表里）</option> : null}
                    {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                  </SelectField>
                ) : (
                  <input
                    id="endpoint-model"
                    name="endpoint-model"
                    autoComplete="off"
                    spellCheck={false}
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder={available.isFetching ? "正在读取模型列表…" : url ? "例如：gpt-5.6-luna" : "填好接口地址后从列表里选"}
                    aria-describedby={listError ? "endpoint-model-error" : undefined}
                  />
                )}
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
        {saving || tested || error ? <CheckRows items={saving ? [{ resource: model, status: "running" }] : error ? [{resource: model || "接口", status: "failed", message: error}]
          : tested!.checks.map((c) => ({resource: c.model, status: c.ok ? "passed" : "failed", message: c.ok ? "" : c.message}))} /> : null}
        <FormActions missing={missing} saving={saving} error={null} saveLabel="保存并验证" onCancel={onCancel ?? (() => navigate(back))} onSave={() => void save()} />
      </div>
    </>
  );
}
