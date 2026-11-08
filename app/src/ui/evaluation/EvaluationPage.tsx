import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { packageEvaluations } from "../../api/evaluations";
import { modelLabel } from "../../domain/resources";
import type { State } from "../../state/store";
import { Notice, NotFound, PageHead } from "../common";
import { Panel } from "../console";
import { EvaluationResults } from "./EvaluationResults";
import { activeEvaluation, evaluationListKey, evaluationsRoute, USAGE } from "./evaluationView";
import { EvaluationStatus } from "./EvaluationsPage";

export function EvaluationPage({ id, state }: { id: string; state: State }) {
  const cache = useQueryClient();
  const key = ["package-evaluation", id];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => packageEvaluations.get(id, signal),
    refetchInterval: ({ state }) => activeEvaluation(state.data?.status) ? 2000 : false,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  const result = query.data;
  const running = activeEvaluation(result?.status);
  const control = useMutation({
    mutationFn: (action: "resume" | "cancel") => packageEvaluations.control(id, action),
    onSuccess: async (next) => {
      await cache.cancelQueries({ queryKey: key });
      cache.setQueryData(key, next);
      void cache.invalidateQueries({ queryKey: evaluationListKey });
    },
  });
  if (query.error instanceof ApiError && query.error.status === 404) {
    return <NotFound kind="评测" back={evaluationsRoute} backLabel="联邦评测" />;
  }

  return <>
    <PageHead title={result?.packageName ?? "联邦评测"} back={{ label: "联邦评测", route: evaluationsRoute }}
      meta={result ? modelLabel(result.model, state.endpoints) : undefined}
      actions={result ? <>
        {result.status === "paused" ? <button type="button" className="button button--primary" disabled={control.isPending}
          onClick={() => control.mutate("resume")}>重试未完成病例</button> : null}
        {running || result.status === "paused" ? <button type="button" className="button button--secondary"
          disabled={control.isPending || (control.isSuccess && control.variables === "cancel" && running)}
          onClick={() => control.mutate("cancel")}>
          {control.isSuccess && control.variables === "cancel" && running ? "正在停止…" : "停止评测"}
        </button> : null}
      </> : undefined} />
    {query.isPending ? <p role="status">正在读取评测…</p> : null}
    {query.isError ? <Notice tone="warning">评测状态读取失败。<button type="button" className="text-link" onClick={() => void query.refetch()}>重试</button></Notice> : null}
    {control.error ? <Notice tone="warning">{control.error.message}</Notice> : null}
    {result ? <>
      <Panel title={USAGE[result.usage]} extra={<EvaluationStatus status={result.status} />}>
        <p>{result.usage === "heldout" ? "病例未参与所选经验包的生成。" : "回测病例参与过经验包生成。验证新病例上的效果需要另选未参与生成的病例。"}</p>
        <p className="muted" role={running ? "status" : undefined}>已完成 {result.paired} / {result.total} 例配对</p>
        {result.error ? <Notice tone="warning">{result.error}</Notice> : null}
      </Panel>
      <EvaluationResults result={result} />
    </> : null}
  </>;
}
