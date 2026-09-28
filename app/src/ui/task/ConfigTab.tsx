import { algorithmOf, scenarioOf } from "../../domain/catalog";
import { INSIGHT_TARGETS, TRACE_DENSITIES } from "../../domain/config";
import { HOSTING_LABELS, modelLabel } from "../../domain/resources";
import { totalProblems, type Member, type Task } from "../../domain/task";
import type { State } from "../../state/store";
import { Facts, Section } from "../common";
import { formatDate, formatNumber } from "../format";
import { inline } from "../labels";

/** 所有参与方取值相同的属性合成一句，只列出不同的。 */
function uniform<T>(members: readonly Member[], pick: (member: Member) => T): T | undefined {
  const first = members[0] ? pick(members[0]) : undefined;
  return members.every((member) => pick(member) === first) ? first : undefined;
}

/** 参与方名称后面的说明：题库名（和参与方不同名时）加题库说明。 */
function noteOf(state: State, member: Member): string {
  const description = state.datasets.find((dataset) => dataset.id === member.datasetId)?.description;
  return [member.dataset !== member.participant ? member.dataset : null, description].filter(Boolean).join(" · ");
}

export function ConfigTab({ task, state }: { task: Task; state: State }) {
  const config = task.config;
  const algorithm = algorithmOf(config.algorithm);
  const problems = totalProblems(task);
  const hosting = uniform(task.members, (member) => member.hosting);
  const model = uniform(task.members, (member) => member.model);
  const allAnswered = task.members.every((member) => member.answered === member.problems);

  const common = [
    hosting ? `都由${HOSTING_LABELS[hosting]}` : null,
    model ? `都用${inline(modelLabel(model, state.endpoints))}` : null,
    allAnswered ? "题目都带标准答案" : null,
  ].filter(Boolean).join("，");

  return (
    <div className="stack stack--loose">
      <Section title="运行" id="config-run" meta="创建时冻结；要修改请“复制为新任务”。">
        <Facts items={[
          ["场景与算法", `${scenarioOf(config.scenario).name} · ${algorithm.name}（${algorithm.fullName}）`],
          ["运行方式", config.mode === "trial" ? `试跑，每份前 ${config.trialCap} 题` : "正式运行，全部题目"],
          ["轮次", `${config.rounds} 轮`],
          ["调用量", `参与方 ${formatNumber(problems * 3 * config.rounds)} 次，服务端至少 ${config.rounds * 2} 次`],
          ["服务端模型", modelLabel(config.serverModel, state.endpoints)],
          ["时间", `创建于 ${formatDate(task.createdAt)}${task.finishedAt ? `，结束于 ${formatDate(task.finishedAt)}` : ""}`],
        ]} />
      </Section>

      <Section title={`参与方 · ${task.members.length} 方`} id="config-members" meta={common ? `${common}。` : undefined}>
        <div className="table-shell">
          <table className="table table--numbers">
            <thead>
              <tr>
                <th scope="col">参与方</th>
                {hosting ? null : <th scope="col">运行位置</th>}
                {model ? null : <th scope="col">模型</th>}
                <th scope="col" className="numeric">本次题数</th>
                {allAnswered ? null : <th scope="col" className="numeric">带答案</th>}
              </tr>
            </thead>
            <tbody>
              {task.members.map((member) => (
                <tr key={member.datasetId}>
                  <th scope="row">
                    <span className="cell-title">
                      {member.participant}
                      <span className="cell-note">{noteOf(state, member)}</span>
                    </span>
                  </th>
                  {hosting ? null : <td>{HOSTING_LABELS[member.hosting]}</td>}
                  {model ? null : <td>{modelLabel(member.model, state.endpoints)}</td>}
                  <td className="numeric">{member.problems}</td>
                  {allAnswered ? null : <td className="numeric">{member.answered}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="复现参数" id="config-params">
        <Facts items={[
          ["洞见库条数", INSIGHT_TARGETS.find((item) => item.id === config.insightTarget)?.label ?? config.insightTarget],
          ["trace 密度", TRACE_DENSITIES.find((item) => item.id === config.traceDensity)?.label ?? config.traceDensity],
          ["每题最多 trace 数", config.maxTracesPerItem === null ? "不限" : `${config.maxTracesPerItem} 条`],
          ["汇总重试上限", `${config.aggregationRetries} 次`],
          ["随机种子 · 并发数", `${config.seed} · ${config.workers}`],
        ]} />
      </Section>

      <Section title="审计记录" id="config-audit">
        <p className="section-text">
          接入后端后，每个任务都会记录：配置快照与哈希、Prompt 1–5 的哈希、每份数据的哈希、上游代码版本（dixiyao/FoT @ b02753c），以及每次调用的模型、token、重试与错误。
        </p>
      </Section>
    </div>
  );
}
