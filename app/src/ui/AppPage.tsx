import { useState } from "react";
import { modelOptions } from "../domain/resources";
import { libraries, type LibraryVersion, type Task } from "../domain/task";
import { hrefOf, type AppTab } from "../state/route";
import type { Published, State } from "../state/store";
import { CodeBlock, EmptyState, Meta, PageHead, TabLinks, Tag } from "./common";
import { FormRow, Panel } from "./console";
import { formatDate } from "./format";
import { Icon } from "./icons";
import { InsightGroups } from "./InsightGroups";
import { algorithmOfTask } from "./labels";

type Props = { item: Published; task: Task | undefined; state: State; tab?: AppTab };

/** 试用的示例题只在产出里包含相关内容时提供；回答是示意文字，不是真实调用结果。 */
const EXAMPLE = {
  insight: "insight_integrality_by_division",
  question: "How many integers x make (4x + 7)/(x - 1) an integer?",
  answer: "4",
  without: { text: "(4x + 7)/(x - 1) = 4 + 11/(x - 1). For this to be an integer, x - 1 must divide 11, so x - 1 = 1 or 11, giving x = 2 or x = 12.\n\nAnswer: \\boxed{2}", boxed: "2" },
  with: { text: "Split off the constant remainder: (4x + 7)/(x - 1) = 4 + 11/(x - 1). The denominator must divide 11, including negative divisors: x - 1 ∈ {1, -1, 11, -11}, so x ∈ {2, 0, 12, -10}. None of them makes the denominator zero.\n\nAnswer: \\boxed{4}", boxed: "4" },
};

function bodyOf(version: LibraryVersion): Record<string, string> {
  return Object.fromEntries(version.insights.map((insight) => [insight.key, insight.text]));
}

function exportApp(item: Published, version: LibraryVersion) {
  const blob = new Blob([`${JSON.stringify(bodyOf(version), null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${item.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** 应用详情：试用、查看内容、接入方式。和原平台的"应用"页一样，选好应用、输入、运行、看结果。 */
export default function AppPage({ item, task, state, tab }: Props) {
  const version = task ? libraries(task).find((library) => library.builtAfterRound === item.builtAfterRound) : undefined;
  if (!task || !version) {
    return (
      <>
        <PageHead title={item.name} crumbs={[{ label: "应用", route: { page: "apps" } }]} />
        <EmptyState title="来源任务已不存在"><p>演示数据重置后，之前发布的应用会失效。</p></EmptyState>
      </>
    );
  }
  const algorithm = algorithmOfTask(task);
  const active: AppTab = tab ?? "try";

  return (
    <>
      <PageHead
        crumbs={[{ label: "应用", route: { page: "apps" } }]}
        title={item.name}
        meta={<Meta parts={[
          `${algorithm.output.name} · ${algorithm.name}`,
          `${version.insights.length} 条`,
          <>来源任务 <a className="text-link" href={hrefOf({ page: "task", id: task.id, tab: "output" })}>{task.name}</a></>,
          `发布于 ${formatDate(item.publishedAt)}`,
        ]} />}
        actions={<button type="button" className="button button--secondary" onClick={() => exportApp(item, version)}><Icon name="download" />导出 JSON</button>}
      />
      <TabLinks
        label="应用"
        tabs={[
          { id: "try", label: "试用" },
          { id: "content", label: "内容" },
          { id: "integrate", label: "接入" },
        ]}
        active={active}
        routeOf={(id) => ({ page: "app", id: item.id, tab: id })}
      />
      <div className="tab-panel">
        {active === "try" ? <TryPanel version={version} state={state} /> : null}
        {active === "content" ? (
          <Panel title={algorithm.output.name} extra={`${version.insights.length} 条`}>
            <InsightGroups insights={version.insights} />
          </Panel>
        ) : null}
        {active === "integrate" ? <IntegratePanel item={item} version={version} /> : null}
      </div>
    </>
  );
}

function TryPanel({ version, state }: { version: LibraryVersion; state: State }) {
  const options = modelOptions(state.endpoints);
  const [model, setModel] = useState(options[0]?.ref ?? "");
  const [question, setQuestion] = useState("");
  const [ran, setRan] = useState<string | null>(null);
  const hasExample = version.insights.some((insight) => insight.key === EXAMPLE.insight);
  const isExample = ran !== null && ran.trim() === EXAMPLE.question;
  const fillExample = () => setQuestion(EXAMPLE.question);

  return (
    <div className="panel-stack">
      <Panel title="试用" extra="同一个问题，分别不带和带上这个应用回答">
        <FormRow
          label="问题"
          htmlFor="try-question"
          hint={hasExample ? <button type="button" className="link-button" onClick={fillExample}>填入示例问题</button> : undefined}
        >
          <textarea id="try-question" name="question" autoComplete="off" className="control-full" rows={4} value={question} placeholder="输入一道数学题…" onChange={(event) => setQuestion(event.target.value)} />
        </FormRow>
        <FormRow label="模型" htmlFor="try-model">
          <select id="try-model" name="model" className="control-wide" value={model} onChange={(event) => setModel(event.target.value)}>
            {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
          </select>
        </FormRow>
        <FormRow label="">
          <button type="button" className="button button--primary" disabled={!question.trim()} onClick={() => setRan(question)}>运行对比</button>
        </FormRow>
      </Panel>

      {ran !== null ? (
        isExample ? (
          <Panel title={<>对比结果<Tag tone="warning">示意</Tag></>} id="try-result" actions={<span className="section-value">标准答案 {EXAMPLE.answer}</span>}>
            <div className="compare-grid">
              {([["不带应用", EXAMPLE.without], ["带应用", EXAMPLE.with]] as const).map(([title, answer]) => {
                const correct = answer.boxed === EXAMPLE.answer;
                return (
                  <div key={title} className="compare-item">
                    <div className="compare-head">
                      <h3>{title}</h3>
                      <span className={correct ? "verdict verdict--right" : "verdict verdict--wrong"}>
                        <Icon name={correct ? "check" : "x"} />{correct ? "正确" : `错误（答 ${answer.boxed}）`}
                      </span>
                    </div>
                    <pre className="answer" lang="en">{answer.text}</pre>
                  </div>
                );
              })}
            </div>
          </Panel>
        ) : (
          <EmptyState
            title="前端原型没有连接模型"
            action={hasExample ? <button type="button" className="button button--secondary" onClick={() => { fillExample(); setRan(EXAMPLE.question); }}>看示例问题的对比</button> : null}
          >
            <p>接入后端后，这里会并排显示两种回答。</p>
          </EmptyState>
        )
      ) : null}
    </div>
  );
}

function IntegratePanel({ item, version }: { item: Published; version: LibraryVersion }) {
  const preview = JSON.stringify(Object.fromEntries(version.insights.slice(0, 2).map((insight) => [insight.key, insight.text])), null, 2);
  return (
    <div className="panel-stack">
      <Panel title="导出" extra={<>JSON 格式，放进自己 Agent 的提示词；和 <code>library_r{version.builtAfterRound + 1}.json</code> 相同</>}>
        <CodeBlock wrap code={`${preview.slice(0, -2)},\n  …\n}`} copyText={`${JSON.stringify(bodyOf(version), null, 2)}\n`} copyLabel="复制完整 JSON" />
      </Panel>
      <Panel title={<>API 与命令行<Tag>规划中</Tag></>}>
        <div className="panel-stack panel-stack--tight">
          <CodeBlock code={`curl -X POST https://<平台地址>/api/v1/apps/${item.id}/run \\
  -H "Authorization: Bearer $FEDAGENT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "…", "model": "default", "compare": true}'`} />
          <CodeBlock code={`fedagent run --app ${item.id} --file questions.jsonl --compare`} />
        </div>
      </Panel>
    </div>
  );
}
