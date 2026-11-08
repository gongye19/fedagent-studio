import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { packageEvaluations } from "../../api/evaluations";
import { isConsultationPackage, MEDICAL_RECORDS } from "../../domain/consultation";
import { availableResource, usableModelOptions } from "../../domain/resources";
import { hrefOf, navigate } from "../../state/route";
import type { State } from "../../state/store";
import { PageHead } from "../common";
import { Field, FieldGroup, Panel } from "../console";
import { SelectField } from "../SelectField";
import { evaluationListKey, evaluationsRoute } from "./evaluationView";

export function NewEvaluationPage({ state }: { state: State }) {
  const cache = useQueryClient();
  const [packageId, setPackageId] = useState("");
  const [model, setModel] = useState("");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [limit, setLimit] = useState("");
  const packages = state.published.filter((item) => isConsultationPackage(item) &&
    state.tasks.some((task) => task.id === item.taskId && task.status === "completed"));
  const datasets = state.datasets.filter((item) => item.taskType === MEDICAL_RECORDS && item.ready &&
    item.source !== "local" && item.answered > 0 && availableResource(item));
  const models = usableModelOptions(state.endpoints);
  const start = useMutation({
    mutationFn: packageEvaluations.start,
    onSuccess: (item) => {
      void cache.invalidateQueries({ queryKey: evaluationListKey });
      navigate({ page: "evaluation", id: item.id });
    },
  });
  const available = datasets.some((item) => item.id === first) && datasets.some((item) => item.id === second);
  const count = datasets.filter((item) => item.id === first || item.id === second)
    .reduce((total, item) => total + Math.min(item.answered, Number(limit || 100)), 0);

  return <>
    <PageHead title="新建联邦评测" back={{ label: "联邦评测", route: evaluationsRoute }} />
    <div className="evaluation-setup">
      <Panel title="评测配置">
        <form className="evaluation-form" onSubmit={(event) => {
          event.preventDefault();
          if (start.isPending || !packageId || !model || !available || first === second) return;
          start.mutate({ packageId, model, datasetIds: [first, second], limit: Number(limit || 100) });
        }}>
          <FieldGroup>
            <Field label="经验包" htmlFor="package-eval-package">
              <SelectField id="package-eval-package" name="packageId" value={packageId} onValueChange={setPackageId}
                disabled={start.isPending || !packages.length}>
                <option value="" disabled>选择已发布的经验包</option>
                {packages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </SelectField>
              {!packages.length ? <a className="text-link" href={hrefOf({ page: "results" })}>查看联邦成果</a> : null}
            </Field>
            {([
              ["first", "第一站病例", first, second, setFirst],
              ["second", "第二站病例", second, first, setSecond],
            ] as const).map(([key, label, selected, other, onChange]) => {
              const id = "package-eval-" + key;
              return <Field key={key} label={label} htmlFor={id}>
                <SelectField id={id} name={key} value={selected} onValueChange={onChange} disabled={start.isPending || !datasets.length}>
                  <option value="" disabled>选择病例数据</option>
                  {datasets.filter((item) => item.id !== other).map((item) => (
                    <option key={item.id} value={item.id}>{item.name}（{item.answered} 例）</option>
                  ))}
                </SelectField>
              </Field>;
            })}
            {datasets.length < 2 ? <a className="text-link" href={hrefOf({ page: "resources" })}>查看联邦数据</a> : null}
            <Field label="评测模型" htmlFor="package-eval-model">
              <SelectField id="package-eval-model" name="model" value={model} onValueChange={setModel}
                disabled={start.isPending || !models.length}>
                <option value="" disabled>选择模型</option>
                {models.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}
              </SelectField>
              {!models.length ? <a className="text-link" href={hrefOf({ page: "models" })}>配置模型接口</a> : null}
            </Field>
            <Field label="每站最多病例" htmlFor="package-eval-limit">
              <input id="package-eval-limit" type="number" min={1} max={100} value={limit} placeholder="100"
                disabled={start.isPending} onChange={(event) => setLimit(event.target.value)} />
            </Field>
          </FieldGroup>
          {available ? <p className="muted">选中 {count} 例，预计作答 {count * 2} 次，另有判分调用。</p> : null}
          {start.error ? <p className="field-error" role="alert">{start.error.message}</p> : null}
          <div className="detail-actions">
            <button type="submit" className="button button--primary" disabled={start.isPending || !packageId || !model || !available}>
              {start.isPending ? "正在提交…" : "开始评测"}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  </>;
}
