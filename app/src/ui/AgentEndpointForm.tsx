import { api } from "../api/client";
import { useState } from "react";
import { agentsApi, type AgentEndpoint } from "../api/agents";
import { keys, queryClient } from "../state/server";
import { FormActions } from "./common";
import { Field, FieldGroup } from "./console";
import { CheckRows } from "./CheckStatus";

export function AgentEndpointForm({
  endpoint,
  onSaved,
  onCancel,
  onBusyChange,
}: {
  endpoint?: AgentEndpoint;
  onSaved: (agent: AgentEndpoint) => void;
  onCancel: () => void;
  onBusyChange?: (value: boolean) => void;
}) {
  const [name, setName] = useState(endpoint?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(endpoint?.baseUrl ?? "");
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState(endpoint?.id);
  const missing = [!name.trim() && "接口名称", !baseUrl.trim() && "服务地址"].filter((s): s is string =>
    Boolean(s),
  );
  async function save() {
    if (saving || missing.length) return;
    setSaving(true);
    onBusyChange?.(true);
    setError(null);
    try {
      const agent = await agentsApi.save(
        { name: name.trim(), baseUrl: baseUrl.trim(), apiKey: clearKey ? "" : key.trim() || null },
        savedId,
      );
      setSavedId(agent.id);
      await queryClient.invalidateQueries({ queryKey: keys.agents });
      try {
        const checked = await agentsApi.check(agent.id);
        await queryClient.invalidateQueries({ queryKey: keys.agents });
        onSaved(checked);
      } catch (failure) {
        setError(`接口已保存，但能力检查未通过：${failure instanceof Error ? failure.message : "请检查服务地址和协议"}`);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "保存失败，请重试");
    } finally {
      setSaving(false);
      onBusyChange?.(false);
    }
  }
  return (
    <div className="resource-intake">
      <div className="agent-intake-head">
        <p>Agent 自行管理模型和工具。</p>
        <button
          type="button"
          className="link-button"
          disabled={saving}
          onClick={() => {
            void api.downloadAgentProtocol().catch(() => setError("接入协议下载失败，请重试"));
          }}
        >
          下载接入协议
        </button>
      </div>
      <FieldGroup>
        <Field label="接口名称" htmlFor="agent-name">
          <input
            id="agent-name"
            value={name}
            maxLength={80}
            disabled={saving}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label="服务地址"
          htmlFor="agent-url"
          info="服务需实现 FedAgent Agent 协议 v1，提供能力声明与工作单元执行接口；普通 LLM 聊天接口请在 LLM 接口中登记。"
        >
          <input
            id="agent-url"
            type="url"
            placeholder="https://agent.your-domain.com"
            value={baseUrl}
            disabled={saving}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </Field>
        <Field
          label="访问密钥"
          htmlFor="agent-key"
          info="可选 Bearer 密钥，加密保存且不能读回。修改地址时必须重新输入密钥。"
        >
          <input
            id="agent-key"
            type="password"
            autoComplete="new-password"
            placeholder={endpoint?.hasKey ? "已保存，留空保留" : "服务无鉴权时留空"}
            value={key}
            disabled={saving || clearKey}
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
        {endpoint?.hasKey ? (
          <Field label="已保存的密钥" htmlFor="agent-clear-key">
            <label className="check-line">
              <input
                id="agent-clear-key"
                type="checkbox"
                disabled={saving}
                checked={clearKey}
                onChange={(event) => setClearKey(event.target.checked)}
              />
              清除已保存的密钥
            </label>
          </Field>
        ) : null}
      </FieldGroup>
      {saving || error ? <CheckRows items={[{ resource: "接口协议", status: saving ? "running" : "failed", message: error ?? "" }]} /> : null}
      <FormActions
        missing={missing}
        saving={saving}
        error={null}
        saveLabel="下一步：验证接入"
        onCancel={onCancel}
        onSave={() => void save()}
      />
    </div>
  );
}
