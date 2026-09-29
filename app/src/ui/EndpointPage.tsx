import { useState, type Dispatch } from "react";
import { DEFAULT_ENDPOINT_ID, type Endpoint } from "../domain/resources";
import { showFlash } from "../state/flash";
import { backTo, navigate, type From } from "../state/route";
import type { Action, State } from "../state/store";
import { Confirm, FormActions, NotFound, PageHead } from "./common";
import { Field, FieldGroup, Panel, UnitInput } from "./console";

type Props = { state: State; dispatch: Dispatch<Action>; id?: string; from?: From };

/**
 * 新增或编辑模型接口，独立页面。接口地址和模型都要填：没有它们，新建任务时选不到这个接口的模型。
 * API 密钥只在服务端保存，前端不收集。
 */
export default function EndpointPage({ state, dispatch, id, from }: Props) {
  const endpoint = id ? state.endpoints.find((item) => item.id === id) : undefined;
  if (id && !endpoint) return <NotFound kind="接口" back={{ page: "models" }} backLabel="模型接口" />;
  return <EndpointForm key={id ?? "new"} state={state} dispatch={dispatch} endpoint={endpoint} from={from} />;
}

function EndpointForm({ state, dispatch, endpoint, from }: { state: State; dispatch: Dispatch<Action>; endpoint?: Endpoint; from?: From }) {
  const [name, setName] = useState(endpoint?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(endpoint?.baseUrl ?? "");
  const [models, setModels] = useState(endpoint?.models.join(", ") ?? "");
  const [concurrency, setConcurrency] = useState(endpoint?.concurrency ?? 8);
  const [price, setPrice] = useState(endpoint?.price === null || endpoint?.price === undefined ? "" : String(endpoint.price));
  const [removing, setRemoving] = useState(false);
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
  const back = backTo(from, { page: "models" });
  const title = endpoint ? `编辑“${endpoint.name}”` : "新增接口";

  function save() {
    if (missing.length) return;
    const fields = { name: name.trim(), baseUrl: url, models: list, concurrency, price: priceValue };
    if (endpoint) {
      dispatch({ type: "updateEndpoint", id: endpoint.id, patch: fields });
      showFlash(back, `已保存“${fields.name}”。`);
    } else {
      const base = fields.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "endpoint";
      let next = base;
      for (let index = 2; state.endpoints.some((item) => item.id === next) || next === DEFAULT_ENDPOINT_ID; index += 1) next = `${base}-${index}`;
      dispatch({ type: "addEndpoint", endpoint: { id: next, ...fields } });
      showFlash(back, `已添加“${fields.name}”，新建任务时可以选它的模型。`);
    }
    navigate(back);
  }

  function remove() {
    if (!endpoint) return;
    dispatch({ type: "removeEndpoint", id: endpoint.id });
    showFlash({ page: "models" }, `已删除“${endpoint.name}”。`);
    navigate({ page: "models" });
  }

  const deletable = endpoint && endpoint.id !== DEFAULT_ENDPOINT_ID;
  return (
    <>
      <PageHead
        title={title}
        crumbs={[{ label: "模型接口", route: { page: "models" } }]}
        actions={deletable && !removing ? <button type="button" className="button button--secondary button--danger" onClick={() => setRemoving(true)}>删除接口</button> : null}
      />
      {removing && endpoint ? (
        <Confirm title={`删除“${endpoint.name}”？`} confirmLabel="删除" onConfirm={remove} onCancel={() => setRemoving(false)}>
          已有任务的配置不受影响；新建任务时不能再选它的模型。
        </Confirm>
      ) : null}
      <div className="form-page">
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
              <Field label="API 密钥">
                <p className="field-static">接入后端后在服务端填写，前端不保存密钥</p>
              </Field>
              <Field label="并发上限" htmlFor="endpoint-concurrency">
                <input id="endpoint-concurrency" name="endpoint-concurrency" type="number" inputMode="numeric" autoComplete="off" min={1} max={256} value={concurrency} onChange={(event) => setConcurrency(Math.max(1, Math.min(256, Number.parseInt(event.target.value, 10) || 1)))} />
              </Field>
              <Field label="单价" optional htmlFor="endpoint-price" error={validPrice ? undefined : "单价不能小于 0"}>
                <UnitInput id="endpoint-price" unit="元 / 百万 token" name="endpoint-price" type="number" inputMode="decimal" autoComplete="off" min={0} step="0.1" value={price} placeholder="未设置" aria-invalid={!validPrice} aria-describedby={validPrice ? undefined : "endpoint-price-error"} onChange={(event) => setPrice(event.target.value)} />
              </Field>
            </FieldGroup>
          </div>
        </Panel>
        <FormActions missing={missing} saveLabel={endpoint ? "保存修改" : "保存接口"} onCancel={() => navigate(back)} onSave={save} />
      </div>
    </>
  );
}
