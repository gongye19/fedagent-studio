import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { agentsApi, type AgentEndpoint } from "../api/agents";
import { ALGORITHMS } from "../domain/catalog";
import { availableResource } from "../domain/resources";
import { keys, queryClient } from "../state/server";
import { CheckRows } from "./CheckStatus";
import { Field, FieldGroup } from "./console";
import { InfoTip } from "./InfoTip";
import { ResourceDialog } from "./ResourceDialog";
import { SelectField } from "./SelectField";
import { ParamField } from "./task-config/ParamField";
import type { ParamValue } from "../domain/catalog";

export function AgentVerificationDialog({ agent, onClose }: { agent: AgentEndpoint; onClose: () => void }) {
  const previous = agent.verifications?.[0];
  const [algorithm, setAlgorithm] = useState(previous?.algorithm ?? "");
  const [dataset, setDataset] = useState(previous?.datasetId ?? "");
  const [started, setStarted] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [params, setParams] = useState<Record<string, ParamValue>>({});
  const [error, setError] = useState<string | null>(null);
  const data = useQuery({ queryKey: keys.datasets, queryFn: api.datasets });
  const algorithms = ALGORITHMS.filter((a) => a.requirements.executionModes.includes("agent") &&
    (!agent.capabilities || agent.capabilities.algorithms[a.id]));
  const selected = algorithms.find((a) => a.id === algorithm);
  const datasets = (data.data ?? []).filter((d) => d.ready && d.source !== "local" && availableResource(d) && selected?.accepts.includes(d.taskType));
  const chosen = datasets.find((d) => d.id === dataset);
  const saved = agent.verifications?.find((v) => v.algorithm === algorithm && v.datasetId === dataset);
  const outdated = !started && saved?.report.status === "passed" && !saved.current;
  const id = started ?? saved?.report.id;
  const report = useQuery({ queryKey: ["task-check", id], queryFn: () => api.taskCheck(id!), enabled: Boolean(id),
    refetchInterval: (query) => ["queued", "running"].includes(query.state.data?.status ?? "") ? 1000 : false });
  const running = submitting || ["queued", "running"].includes(report.data?.status ?? "");
  useEffect(() => {
    if (report.data?.status === "passed" || report.data?.status === "failed")
      void queryClient.invalidateQueries({ queryKey: keys.agents });
  }, [report.data?.status, id]);
  async function verify() {
    if (!chosen || !selected || running) return;
    setSubmitting(true); setError(null);
    try {
      const value = await agentsApi.verify(agent.id, { algorithm, taskType: chosen.taskType, datasetId: chosen.id, params });
      setStarted(value.id);
      queryClient.setQueryData(["task-check", value.id], value);
      await queryClient.invalidateQueries({ queryKey: keys.agents });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "验证失败，请重试"); }
    finally { setSubmitting(false); }
  }
  return <ResourceDialog title={`验证“${agent.name}”`} open busy={submitting} onOpenChange={(open) => { if (!open) onClose(); }}>
    <div className="verification-form">
      <FieldGroup>
        <Field label="算法" htmlFor="verification-algorithm" info="验证该算法要求的完整步骤与返回格式。实际模型调用可能需要几分钟，仅在接入或修改接口时进行。">
          <SelectField id="verification-algorithm" value={algorithm} disabled={running} onValueChange={(value) => { setAlgorithm(value); setDataset(""); setParams({}); setStarted(null); }}>
            <option value="">选择算法</option>{algorithms.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </SelectField>
        </Field>
        <Field label="验证数据" htmlFor="verification-data" info="向这个 Agent 发送所选数据中的最少样本，验证真实输出；不会启动联邦任务或启用测试经验。">
          <SelectField id="verification-data" value={dataset} disabled={running || !selected} onValueChange={(value) => { setDataset(value); setStarted(null); }}>
            <option value="">选择已上传的数据</option>{datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </SelectField>
        </Field>
      </FieldGroup>
      {selected?.params.length ? <details><summary>验证参数</summary><div inert={running}><FieldGroup>{selected.params.map((def) =>
        <ParamField key={def.key} def={def} params={params} onChange={(value) => setParams((old) => ({...old, [def.key]: value}))} />
       )}</FieldGroup></div></details> : null}
      {selected && !datasets.length ? <p className="field-error">请先在数据资源页上传兼容数据。</p> : null}
      <CheckRows items={!outdated && report.data?.results.length ? report.data.results : [{ resource: "接口与输出规范", status: running ? "running" : "pending" }]} />
      {outdated ? <p className="field-error">接口已变更，请重新验证。</p> : null}
      {error || report.error ? <p className="field-error" role="alert">{error ?? "无法读取验证进度，请重试"}</p> : null}
      <div className="form-actions">
        <button className="button button--secondary" disabled={submitting} onClick={onClose}>关闭</button>
        <button className="button button--primary" disabled={!chosen || running} onClick={() => void verify()}>
          {running ? "验证中" : report.data ? "重新验证" : "验证接入"}
        </button>
        <InfoTip label="验证费用">使用真实样本调用接入方 Agent，会消耗其模型额度。</InfoTip>
      </div>
    </div>
  </ResourceDialog>;
}
