import { useState, type Dispatch } from "react";
import { modelLabel, modelOptions } from "../domain/resources";
import { libraries, type LibraryVersion, type Task } from "../domain/task";
import { hrefOf, type LibraryTab } from "../state/route";
import type { Action, Published, State } from "../state/store";
import { Badge, EmptyState, PageHead, Section, TabLinks } from "./common";
import { formatDate, formatNumber } from "./format";
import { Icon } from "./icons";
import { InsightGroups } from "./InsightGroups";
import { inline } from "./labels";

type Props = { item: Published; task: Task | undefined; state: State; dispatch: Dispatch<Action>; tab?: LibraryTab };

/** 试用页的示例题只在洞见库包含相关洞见时提供；回答是示意文字，不是真实调用结果。 */
const EXAMPLE = {
  insight: "insight_integrality_by_division",
  question: "How many integers x make (4x + 7)/(x - 1) an integer?",
  answer: "4",
  without: { text: "(4x + 7)/(x - 1) = 4 + 11/(x - 1). For this to be an integer, x - 1 must divide 11, so x - 1 = 1 or 11, giving x = 2 or x = 12.\n\nAnswer: \\boxed{2}", boxed: "2" },
  with: { text: "Split off the constant remainder: (4x + 7)/(x - 1) = 4 + 11/(x - 1). The denominator must divide 11, including negative divisors: x - 1 ∈ {1, -1, 11, -11}, so x ∈ {2, 0, 12, -10}. None of them makes the denominator zero.\n\nAnswer: \\boxed{4}", boxed: "4" },
};

function exportLibrary(item: Published, version: LibraryVersion) {
  // 与 FoT 运行目录里的 library_r{n}.json 同一格式：insight 名 → 描述。
  const body = Object.fromEntries(version.insights.map((insight) => [insight.key, insight.text]));
  const blob = new Blob([`${JSON.stringify(body, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${item.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function LibraryPage({ item, task, state, tab }: Props) {
  const version = task ? libraries(task).find((library) => library.builtAfterRound === item.builtAfterRound) : undefined;
  if (!task || !version) {
    return (
      <>
        <PageHead title={item.name} crumbs={[{ label: "洞见库", route: { page: "libraries" } }]} />
        <EmptyState title="来源任务已不存在"><p>演示数据重置后，之前发布的洞见库会失效。</p></EmptyState>
      </>
    );
  }
  const active: LibraryTab = tab ?? "insights";

  return (
    <>
      <PageHead
        crumbs={[{ label: "洞见库", route: { page: "libraries" } }]}
        title={item.name}
        meta={<>{version.insights.length} 条洞见 · 来自 {task.members.length} 个参与方的 {formatNumber(version.traceCount)} 条 trace · 任务 <a className="text-link" href={hrefOf({ page: "task", id: task.id, tab: "library" })}>{task.name}</a> · 发布于 {formatDate(item.publishedAt)}</>}
        actions={<button type="button" className="button button--secondary" onClick={() => exportLibrary(item, version)}><Icon name="download" />导出 JSON</button>}
      />
      <TabLinks
        label="洞见库"
        tabs={[
          { id: "insights", label: "洞见" },
          { id: "try", label: "试用" },
          { id: "integrate", label: "接入方式" },
        ]}
        active={active}
        routeOf={(id) => ({ page: "library", id: item.id, tab: id })}
        end={<Badge tone="sample">示例数据</Badge>}
      />
      <div className="tab-panel">
        {active === "insights" ? <InsightGroups insights={version.insights} /> : null}
        {active === "try" ? <TryPanel version={version} state={state} /> : null}
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
  const contextTokens = Math.round(version.insights.reduce((sum, insight) => sum + insight.text.length + insight.key.length, 0) / 4);
  const isExample = ran !== null && ran.trim() === EXAMPLE.question;

  return (
    <div className="stack stack--loose">
      <div className="try-form">
        <label className="field">
          <span>题目</span>
          <textarea rows={4} value={question} placeholder="输入一道数学题" onChange={(event) => setQuestion(event.target.value)} />
        </label>
        <div className="try-bar">
          <label className="field field--inline">
            <span>模型</span>
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
            </select>
          </label>
          <div className="try-actions">
            {hasExample ? <button type="button" className="button button--ghost" onClick={() => setQuestion(EXAMPLE.question)}>填入示例题</button> : null}
            <button type="button" className="button button--primary" disabled={!question.trim()} onClick={() => setRan(question)}>对比：不带库 / 带库</button>
          </div>
        </div>
        <p className="section-meta">带库时，整份洞见库（{version.insights.length} 条，约 {formatNumber(contextTokens)} token）按 FoT 的解题提示词放进上下文；不带库时只给题目。</p>
      </div>

      {ran !== null ? (
        isExample ? (
          <Section title="回答对比" id="try-result" meta={`以下是说明用的示意，不是真实的模型输出；接入后端后由${inline(modelLabel(model, state.endpoints))}实际作答。标准答案：${EXAMPLE.answer}`}>
            <div className="compare-grid">
              {([["不带洞见库", EXAMPLE.without], ["带洞见库", EXAMPLE.with]] as const).map(([title, answer]) => {
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
          </Section>
        ) : (
          <EmptyState title="前端原型没有连接模型"><p>接入后端后，这里会并排显示两种方式的回答；题目带标准答案时还会自动判分。</p></EmptyState>
        )
      ) : null}
    </div>
  );
}

function IntegratePanel({ item, version }: { item: Published; version: LibraryVersion }) {
  const preview = JSON.stringify(Object.fromEntries(version.insights.slice(0, 2).map((insight) => [insight.key, insight.text])), null, 2);
  return (
    <div className="stack stack--loose">
      <Section title="导出后放进自己 Agent 的提示词" id="integrate-export" meta={<>格式与 FoT 运行目录里的 <code>library_r{version.builtAfterRound + 1}.json</code> 相同：洞见名 → 描述。</>}>
        <pre className="code-block code-block--wrap">{`${preview.slice(0, -2)},\n  …\n}`}</pre>
      </Section>
      <Section title="通过 API 调用" id="integrate-api" meta="接入后端后提供，与界面共用一套接口和权限。">
        <pre className="code-block">{`curl -X POST https://<平台地址>/api/v1/libraries/${item.id}/apply \\
  -H "Authorization: Bearer $FEDAGENT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"question": "…", "model": "default", "compare": true}'`}</pre>
      </Section>
      <Section title="命令行" id="integrate-cli" meta="接入后端后提供。">
        <pre className="code-block">{`fedagent apply --library ${item.id} --file questions.jsonl --compare`}</pre>
      </Section>
    </div>
  );
}
