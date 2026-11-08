import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { consultationComparisons, type ConsultationComparisonArm } from "../../api/consultationComparison";
import { isConsultationPackage } from "../../domain/consultation";
import { modelLabel, usableModelOptions } from "../../domain/resources";
import { hrefOf, navigate, type Route } from "../../state/route";
import type { State } from "../../state/store";
import { PageHead, Tag, type Tone } from "../common";
import { Field, FieldGroup, Panel } from "../console";
import { SelectField } from "../SelectField";
import { ComparisonConversation } from "./ComparisonConversation";
import { ComparisonCasePicker } from "./ComparisonCasePicker";

const comparisonRoute = (comparison: string): Route => ({ page: "consultation", comparison });
const back = { label: "医疗问诊", route: { page: "consultation" } } as const;
const activeKey = ["consultation-comparison-active"];
const runKey = (id: string) => ["consultation-comparison", id];
const statuses: Record<ConsultationComparisonArm["status"], [string, Tone]> = {
  waiting: ["等待开始", "neutral"],
  running: ["问诊中", "info"],
  diagnosed: ["已提交诊断", "success"],
  limit: ["达到上限，未提交诊断", "warning"],
  failed: ["已暂停", "warning"],
  canceled: ["已停止", "neutral"],
};

function Setup({ state, packageId }: { state: State; packageId?: string }) {
  const cache = useQueryClient();
  const packages = state.published.filter(isConsultationPackage);
  const models = usableModelOptions(state.endpoints);
  const [selectedCase, setCase] = useState("");
  const [selectedPackage, setPackage] = useState(packageId ?? "");
  const [selectedModel, setModel] = useState<string>();
  const model = selectedModel ?? models[0]?.ref ?? "";
  const hasPackage = packages.some((item) => item.id === selectedPackage);
  const cases = useQuery({
    queryKey: ["consultation-comparison-cases", selectedPackage],
    queryFn: ({ signal }) => consultationComparisons.cases(selectedPackage, signal),
    enabled: hasPackage,
    staleTime: 60_000,
  });
  const active = useQuery({ queryKey: activeKey, queryFn: ({ signal }) => consultationComparisons.active(signal) });
  const caseItem = cases.data?.find((item) => item.id === selectedCase);
  const start = useMutation({
    mutationFn: consultationComparisons.start,
    onSuccess: (run) => {
      cache.setQueryData(runKey(run.id), run);
      void cache.invalidateQueries({ queryKey: activeKey });
      navigate(comparisonRoute(run.id));
    },
    onError: () => void cache.invalidateQueries({ queryKey: activeKey }),
  });
  const canStart = Boolean(caseItem && hasPackage && model && active.isSuccess && !active.data);

  return <>
    <PageHead title="实时问诊对比" back={back} />
    {active.data ? <Panel title="有一场未结束的对比" actions={
      <a className="button button--primary" href={hrefOf(comparisonRoute(active.data.id))}>查看问诊</a>
    }>{active.data.case.title}</Panel> : <Panel title="开始对比" className="consultation-compare-setup">
      <form className="evaluation-form" onSubmit={(event) => {
        event.preventDefault();
        if (caseItem && canStart && !start.isPending) start.mutate({ caseId: caseItem.id, packageId: selectedPackage, model });
      }}>
        <FieldGroup>
          <Field label="经验包" htmlFor="compare-package">
            <SelectField id="compare-package" value={selectedPackage} onValueChange={(id) => { setPackage(id); setCase(""); start.reset(); }} disabled={start.isPending || !packages.length}>
              <option value="" disabled>选择经验包</option>
              {packages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </SelectField>
          </Field>
          <Field label="两栏共用模型" htmlFor="compare-model">
            <SelectField id="compare-model" value={model} onValueChange={setModel} disabled={start.isPending || !models.length}>
              <option value="" disabled>请选择模型</option>
              {models.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}
            </SelectField>
          </Field>
        </FieldGroup>
        <Field label="留出病例" htmlFor="compare-case">
          <ComparisonCasePicker options={cases.data ?? []} selected={caseItem}
            disabled={start.isPending || !cases.data?.length}
            placeholder={!hasPackage ? "先选择经验包" : cases.isPending ? "正在加载病例…" : "暂无可用留出病例"}
            onSelect={(id) => { setCase(id); start.reset(); }} />
        </Field>
        {(start.error || active.error || cases.error) && <p className="field-error" role="alert">
          {(start.error ?? active.error ?? cases.error)?.message}
        </p>}
        <div className="detail-actions"><button className="button button--primary" disabled={!canStart || start.isPending}>
          {start.isPending ? "正在启动…" : "开始双栏问诊"}
        </button></div>
      </form>
    </Panel>}
  </>;
}

function ComparisonColumn({ arm, packageName, opening, reference }: {
  arm: ConsultationComparisonArm; packageName: string; opening: string; reference?: string | null;
}) {
  const [label, tone] = statuses[arm.status];
  return <Panel title={arm.arm === "baseline" ? "无经验" : packageName} id={`comparison-${arm.arm}`}
    actions={<Tag tone={reference ? "neutral" : tone} live={arm.status === "running"}>{reference ? "问诊结束" : label}</Tag>}>
    <ComparisonConversation arm={arm} opening={opening} reference={reference} />
  </Panel>;
}

function Run({ id, state }: { id: string; state: State }) {
  const cache = useQueryClient();
  const run = useQuery({
    queryKey: runKey(id),
    queryFn: ({ signal }) => consultationComparisons.get(id, signal),
    refetchInterval: ({ state }) => state.data?.status === "running" || state.data?.status === "queued" ? 1500 : false,
  });
  const control = useMutation({
    mutationFn: (action: "resume" | "cancel") => consultationComparisons.control(id, action),
    onSuccess: (item) => {
      cache.setQueryData(runKey(id), item);
      void cache.invalidateQueries({ queryKey: activeKey });
    },
  });
  const item = run.data;
  const complete = item?.status === "completed";
  const pending = item?.status === "queued" || item?.status === "running";
  return <>
    <PageHead title="实时问诊对比" back={back} actions={item && <div className="detail-actions">
      {item.status === "paused" && <button type="button" className="button button--primary" disabled={control.isPending}
        onClick={() => control.mutate("resume")}>继续问诊</button>}
      {pending || item.status === "paused"
        ? <button type="button" className="button button--ghost" disabled={control.isPending}
          onClick={() => control.mutate("cancel")}>停止</button>
        : <a className="button button--ghost" href={hrefOf(comparisonRoute("new"))}>重新对比</a>}
    </div>} />
    {(run.error || control.error || item?.error) && <p className="field-error" role="alert">{run.error?.message ?? control.error?.message ?? item?.error}</p>}
    {!item ? (run.isPending && <p role="status" className="muted">正在加载问诊…</p>) : <div className="consultation-comparison">
      <Panel title={item.case.title} actions={<Tag>留出病例</Tag>}>
        <p className="muted comparison-model">{modelLabel(item.model, state.endpoints, { withStatus: false })}</p>
        {pending && item.arms.every((arm) => arm.status === "diagnosed" || arm.status === "limit") &&
          <p className="muted comparison-model" role="status">正在核对两栏诊断…</p>}
      </Panel>
      <div className="comparison-columns">
        {item.arms.map((arm) => <ComparisonColumn key={arm.arm} arm={arm} packageName={item.packageName} opening={item.case.opening} reference={complete ? item.reference : undefined} />)}
      </div>
    </div>}
  </>;
}

export function ConsultationComparisonPage({ id, state, packageId }: { id: string; state: State; packageId?: string }) {
  return id === "new" ? <Setup state={state} packageId={packageId} /> : <Run state={state} id={id} />;
}
