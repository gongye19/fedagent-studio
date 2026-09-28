import { algorithmOf, scenarioOf } from "../../domain/catalog";
import { INSIGHT_TARGETS, TRACE_DENSITIES } from "../../domain/config";
import { HOSTING_LABELS, modelLabel } from "../../domain/resources";
import { totalProblems, type Task } from "../../domain/task";
import type { State } from "../../state/store";
import { Badge, Facts, Panel } from "../common";
import { formatDate, formatNumber } from "../format";

export function ConfigTab({ task, state }: { task: Task; state: State }) {
  const config = task.config;
  const algorithm = algorithmOf(config.algorithm);
  const problems = totalProblems(task);
  return (
    <div className="stack">
      <Panel title="任务配置" id="frozen-config" extra={<small className="muted">创建时冻结，要修改请"复制为新任务"</small>}>
        <Facts items={[
          ["场景", scenarioOf(config.scenario).name],
          ["算法", `${algorithm.name} · ${algorithm.fullName}`],
          ["运行方式", config.mode === "trial" ? `试跑 · 每份前 ${config.trialCap} 题` : "正式运行 · 全部题目"],
          ["轮次", `${config.rounds} 轮`],
          ["服务端模型", modelLabel(config.serverModel, state.endpoints)],
          ["洞见库条数", INSIGHT_TARGETS.find((item) => item.id === config.insightTarget)?.label ?? config.insightTarget],
          ["trace 密度", TRACE_DENSITIES.find((item) => item.id === config.traceDensity)?.label ?? config.traceDensity],
          ["每题最多 trace 数", config.maxTracesPerItem === null ? "不限" : `${config.maxTracesPerItem} 条`],
          ["汇总重试上限", `${config.aggregationRetries} 次`],
          ["随机种子", String(config.seed)],
          ["并发数", String(config.workers)],
          ["调用量", `参与方 ${formatNumber(problems * 3 * config.rounds)} 次 · 服务端至少 ${config.rounds * 2} 次`],
          ["创建时间", formatDate(task.createdAt)],
          ...(task.finishedAt ? [["结束时间", formatDate(task.finishedAt)] as const] : []),
        ]} />
      </Panel>

      <Panel title="参与方" id="members" flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">参与方</th>
                <th scope="col">运行位置</th>
                <th scope="col">数据</th>
                <th scope="col" className="numeric">本次题数</th>
                <th scope="col" className="numeric">带答案</th>
                <th scope="col">模型</th>
              </tr>
            </thead>
            <tbody>
              {task.members.map((member) => (
                <tr key={member.datasetId}>
                  <th scope="row">{member.participant}</th>
                  <td>{HOSTING_LABELS[member.hosting]}</td>
                  <td>{member.dataset}</td>
                  <td className="numeric">{member.problems}</td>
                  <td className="numeric">{member.answered}</td>
                  <td>{modelLabel(member.model, state.endpoints)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="审计记录" id="audit">
        <ul className="audit-list">
          {[
            "配置快照与哈希",
            "Prompt 1–5 的哈希（上游提示词原样使用）",
            "每份数据的哈希",
            "上游代码版本（dixiyao/FoT @ b02753c）",
            "每次调用的模型、token 用量、重试与错误",
          ].map((item) => (
            <li key={item}><span>{item}</span><Badge>接入后端后记录</Badge></li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
