import { paramText, scenarioOf, TASK_TYPES, GRADERS } from "../../domain/catalog";
import { DATA_LOCATION_LABELS, modelLabel } from "../../domain/resources";
import { totalProblems, type Member, type Task } from "../../domain/task";
import type { State } from "../../state/store";
import { Facts } from "../common";
import { Panel } from "../console";
import { formatDate, formatNumber } from "../format";
import { algorithmOfTask } from "../labels";

/** 所有参与方取值相同的属性合成一列就够了，不同时才单列。 */
function uniform<T>(members: readonly Member[], pick: (member: Member) => T): T | undefined {
  const first = members[0] ? pick(members[0]) : undefined;
  return members.every((member) => pick(member) === first) ? first : undefined;
}

/** 创建时冻结的配置。要修改请"复制为新任务"。 */
export function ConfigTab({ task, state }: { task: Task; state: State }) {
  const config = task.config;
  const algorithm = algorithmOfTask(task);
  const grader = GRADERS[config.grader ?? TASK_TYPES[config.taskType].grader];
  const serverStageModel = algorithm.stages.some((stage) => stage.side === "server" && stage.model);
  const model = uniform(task.members, (member) => member.model);
  const label = (ref: string) => ref.startsWith("agent:")
    ? task.members.find((m) => m.model === ref)?.agentName ?? "自有 Agent"
    : modelLabel(ref, state.endpoints, { withStatus: false });

  return (
    <div className="panel-stack">
      <Panel title="任务配置" extra="创建时冻结；要修改请“复制为新任务”">
        <Facts className="facts--columns" items={[
          ["场景", scenarioOf(config.scenario).short],
          ["算法", `${algorithm.name}（${algorithm.fullName}）`],
          ["任务类型", TASK_TYPES[config.taskType].label],
          ["运行方式", config.mode === "trial" ? `试跑，每个数据集前 ${config.trialCap} 条` : "正式运行，全部样本"],
          ["轮次", `${config.rounds} 轮`],
          ["样本", `${formatNumber(totalProblems(task))} 条`],
          [config.execution === "agent" ? "执行 Agent" : "运行模型", model ? label(model) : "各来源不同，见下表"],
          ...(serverStageModel || grader?.requiresModel ? [[serverStageModel ? "服务端模型" : "评测模型", label(config.serverModel)] as const] : []),
          ["判分规则", grader?.label ?? config.grader ?? "—"],
          ["并发数", String(config.workers)],
          ["随机种子", String(config.seed)],
          ["创建时间", formatDate(task.createdAt)],
          [task.status === "canceled" ? "取消时间" : "完成时间", task.finishedAt ? formatDate(task.finishedAt) : "—"],
        ]} />
      </Panel>

      <Panel title={`${algorithm.name} 算法参数`}>
        <Facts className="facts--columns" items={algorithm.params.map((def) => [def.label, paramText(def, config.params)] as const)} />
      </Panel>

      <Panel title="参与方" extra={`${task.members.length} 个`} flush>
        <div className="table-shell">
          <table className="table table--numbers">
            <thead>
              <tr>
                <th scope="col">参与方</th>
                <th scope="col" className="col-optional">数据集</th>
                <th scope="col" className="col-optional">数据位置</th>
                {model ? null : <th scope="col">{config.execution === "agent" ? "Agent" : "模型"}</th>}
                <th scope="col" className="numeric">本次样本</th>
              </tr>
            </thead>
            <tbody>
              {task.members.map((member) => (
                <tr key={member.participantId}>
                  <th scope="row">{member.participant}</th>
                  <td className="col-optional">{member.dataset}</td>
                  <td className="col-optional">{DATA_LOCATION_LABELS[member.hosting]}</td>
                  {model ? null : <td>{label(member.model)}</td>}
                  <td className="numeric">{member.problems}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
