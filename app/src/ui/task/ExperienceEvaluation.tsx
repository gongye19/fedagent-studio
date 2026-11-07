import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../../api/client";
import { experienceEvaluation, type Evaluation, type EvaluationCase, type EvaluationScore, type EvaluationSource } from "../../api/consultation";
import { modelLabel } from "../../domain/resources";
import type { Task } from "../../domain/task";
import type { State } from "../../state/store";
import { Notice, Stat } from "../common";
import { Panel } from "../console";
import { formatDelta, formatPercent } from "../format";
import { SelectField } from "../SelectField";
import { ExperienceEvaluationForm } from "./ExperienceEvaluationForm";

const ARMS = [
  { id: "none", name: "无经验" },
  { id: "local", name: "本站经验" },
  { id: "federated", name: "联邦经验" },
] as const;
const CHANGE = { improved: "由错变对", worsened: "由对变错", unchanged: "结果不变", incomplete: "未完成配对" } as const;

function delta(score: EvaluationScore) {
  return score.paired ? formatDelta((score.federated - score.local) / score.paired) : "—";
}

function EvaluationResults({ result }: { result: Evaluation }) {
  const [site, setSite] = useState("all");
  const [change, setChange] = useState<"all" | EvaluationCase["change"]>("all");
  const visible = result.cases.filter((item) => (site === "all" || item.siteId === site) && (change === "all" || item.change === change));
  const score = result.sites.find((item) => item.id === site) ?? result.score;
  return (
    <div className="evaluation-results">
      <div className="list-toolbar">
        <SelectField name="eval-site" aria-label="评测来源" value={site} onValueChange={setSite}>
          <option value="all">全部来源</option>
          {result.sites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </SelectField>
      </div>
      <dl className="stats">
        {ARMS.map(({ id, name }) => <Stat key={id} label={`${name} · 诊断匹配率`}
          value={formatPercent(score.paired ? score[id] / score.paired : null)} sub={`${score[id]} / ${score.paired} 例匹配`} />)}
        <Stat label="联邦经验较本站" value={delta(score)} sub={`${score.paired} / ${score.total} 例完成三组配对`} />
      </dl>
      <div className="evaluation-filters" aria-label="筛选病例变化">
        {([
          ["all", "全部病例", score.total],
          ["improved", CHANGE.improved, score.improved],
          ["worsened", CHANGE.worsened, score.worsened],
          ["unchanged", CHANGE.unchanged, score.unchanged],
          ["incomplete", CHANGE.incomplete, score.total - score.paired],
        ] as const).map(([id, label, count]) => (
          <button key={id} type="button" className="button button--secondary button--compact" aria-pressed={change === id}
            onClick={() => setChange(id)}>{label} {count}</button>
        ))}
      </div>
      <div className="evaluation-cases">
        {visible.length ? visible.map((item) => (
          <details key={`${item.siteId}/${item.caseId}`} className="evaluation-case">
            <summary><span>{item.caseId} · {result.sites.find((entry) => entry.id === item.siteId)?.name}</span>
              <strong className={`evaluation-${item.change}`}>{CHANGE[item.change]}</strong></summary>
            <p className="muted">参考诊断 · {item.reference}</p>
            <div className="evaluation-answers">
              {ARMS.map(({ id, name }) => {
                const arm = item.arms[id];
                return <article key={id}>
                  <h4>{name} · {arm?.correct === true ? "匹配" : arm?.correct === false ? "未匹配" : "未完成"}</h4>
                  <p>{arm?.output ?? arm?.error ?? "等待评测"}</p>
                  {arm?.experienceKeys?.length ? <details><summary>本组提供的经验（{arm.experienceKeys.length}）</summary>
                    <ul>{arm.experienceKeys.map((key) => <li key={key}>{key}</li>)}</ul>
                  </details> : null}
                </article>;
              })}
            </div>
          </details>
        )) : <p className="muted">没有符合条件的病例。</p>}
      </div>
    </div>
  );
}

export function ExperienceEvaluation({ task, state }: { task: Task; state: State }) {
  const cache = useQueryClient();
  const key = ["experience-evaluation", task.id];
  const [configuring, setConfiguring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const query = useQuery({
    queryKey: key,
    queryFn: () => experienceEvaluation.get(task.id),
    refetchInterval: ({ state }) => state.data?.status === "running" || state.data?.status === "queued" ? 2000 : false,
  });
  const result = query.data;
  const running = result?.status === "queued" || result?.status === "running";
  async function act(run: () => Promise<Evaluation>) {
    if (busy) return;
    setBusy(true);
    setProblem("");
    try {
      const next = await run();
      await cache.cancelQueries({ queryKey: key });
      cache.setQueryData(key, next);
      setConfiguring(false);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "请求失败，请重试。");
      void query.refetch();
    } finally {
      setBusy(false);
    }
  }

  const start = (body: { model: string; sources: EvaluationSource[] }) => act(() => experienceEvaluation.start(task.id, body));
  return (
    <Panel id="experience-evaluation" title="独立病例评测" extra={result ? modelLabel(result.model, state.endpoints) : undefined} actions={
      result?.status === "paused" ? <button className="button button--primary button--compact" disabled={busy}
        onClick={() => void act(() => experienceEvaluation.control(task.id, "resume"))}>重试未完成病例</button>
      : running ? <button className="button button--secondary button--compact" disabled={busy}
        onClick={() => void act(() => experienceEvaluation.control(task.id, "cancel"))}>停止评测</button>
      : query.isSuccess && !result && !configuring ? <button className="button button--primary button--compact" onClick={() => setConfiguring(true)}>评测效果</button>
      : undefined
    }>
      {problem ? <Notice tone="warning">{problem}</Notice> : null}
      {query.isPending ? <p role="status">正在读取评测状态…</p> : null}
      {query.isError ? <Notice tone="warning">评测状态读取失败。<button type="button" className="text-link" onClick={() => void query.refetch()}>重试</button></Notice> : null}
      {query.isSuccess && !result ? configuring
        ? <ExperienceEvaluationForm task={task} state={state} busy={busy} onStart={start} onClose={() => setConfiguring(false)} />
        : <p>用留出病例对比无经验、本站经验和联邦经验，查看诊断匹配率与逐例变化。</p> : null}
      {result && running ? <p role="status">{result.status === "queued" ? "评测排队中" : "正在评测"} · 已完成 {result.score.paired} / {result.score.total} 例三组对照</p> : null}
      {result?.error ? <Notice tone="warning">{result.error}</Notice> : null}
      {result?.status === "canceled" ? <p>评测已停止，以下为已保存的结果。</p> : null}
      {result && !running ? <EvaluationResults result={result} /> : null}
    </Panel>
  );
}
