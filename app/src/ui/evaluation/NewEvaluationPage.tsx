import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { packageEvaluations } from "../../api/evaluations";
import { isConsultationPackage } from "../../domain/consultation";
import { usableModelOptions } from "../../domain/resources";
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
  const packages = state.published.filter((item) => isConsultationPackage(item) &&
    state.tasks.some((task) => task.id === item.taskId && task.status === "completed"));
  const models = usableModelOptions(state.endpoints);
  const start = useMutation({
    mutationFn: packageEvaluations.start,
    onSuccess: (item) => {
      void cache.invalidateQueries({ queryKey: evaluationListKey });
      navigate({ page: "evaluation", id: item.id });
    },
  });

  return <>
    <PageHead title="新建联邦评测" back={{ label: "联邦评测", route: evaluationsRoute }} />
    <div className="evaluation-setup">
      <Panel title="评测配置">
        <form className="evaluation-form" onSubmit={(event) => {
          event.preventDefault();
          if (start.isPending || !packageId || !model) return;
          start.mutate({ packageId, model });
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
            <Field label="评测模型" htmlFor="package-eval-model">
              <SelectField id="package-eval-model" name="model" value={model} onValueChange={setModel}
                disabled={start.isPending || !models.length}>
                <option value="" disabled>选择模型</option>
                {models.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}
              </SelectField>
              {!models.length ? <a className="text-link" href={hrefOf({ page: "models" })}>配置模型接口</a> : null}
            </Field>
          </FieldGroup>
          <p className="muted">自动评测经验包所有来源站点的全部已标注病例。每例分别运行无经验和加载经验包两组。</p>
          {start.error ? <p className="field-error" role="alert">{start.error.message}</p> : null}
          <div className="detail-actions">
            <button type="submit" className="button button--primary" disabled={start.isPending || !packageId || !model}>
              {start.isPending ? "正在提交…" : "开始评测"}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  </>;
}
