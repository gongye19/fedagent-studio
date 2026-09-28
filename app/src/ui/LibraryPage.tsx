import { useState, type Dispatch } from "react";
import { modelLabel, modelOptions } from "../domain/resources";
import { libraries, type LibraryVersion, type Task } from "../domain/task";
import { hrefOf, type LibraryTab } from "../state/route";
import type { Action, Published, State } from "../state/store";
import { Badge, EmptyState, Note, PageHead, Panel, TabLinks } from "./common";
import { formatDate, formatNumber } from "./format";
import { Icon } from "./icons";

type Props = { item: Published; task: Task | undefined; state: State; dispatch: Dispatch<Action>; tab?: LibraryTab };

/** 试用页的示例题只在洞见库包含相关洞见时提供，回答是示意文字，不是真实调用结果。 */
const EXAMPLE = {
  insight: "insight_integrality_by_division",
  question: "How many integers x make (4x + 7)/(x - 1) an integer?",
  without: "(4x + 7)/(x - 1) = 4 + 11/(x - 1). For this to be an integer, x - 1 must divide 11, so x - 1 = 1 or 11, giving x = 2 or x = 12.\n\nAnswer: \\boxed{2}",
  with: "Split off the constant remainder: (4x + 7)/(x - 1) = 4 + 11/(x - 1). The denominator must divide 11, including negative divisors: x - 1 ∈ {1, -1, 11, -11}, so x ∈ {2, 0, 12, -10}. None of them makes the denominator zero.\n\nAnswer: \\boxed{4}",
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
        <EmptyState title="来源任务已不存在">演示数据重置后，之前发布的洞见库会失效。</EmptyState>
      </>
    );
  }
  const active: LibraryTab = tab ?? "insights";
  const categories = [...new Set(version.insights.map((insight) => insight.category))];

  return (
    <>
      <PageHead
        crumbs={[{ label: "洞见库", route: { page: "libraries" } }]}
        title={item.name}
        meta={<>来自任务 <a className="text-link" href={hrefOf({ page: "task", id: task.id, tab: "library" })}>{task.name}</a> · 第 {item.builtAfterRound} 轮后生成 · {version.insights.length} 条洞见 · {task.members.length} 个参与方的 {formatNumber(version.traceCount)} 条 trace · 发布于 {formatDate(item.publishedAt)}</>}
        actions={<button type="button" className="button button--secondary" onClick={() => exportLibrary(item, version)}><Icon name="download" />导出 JSON</button>}
      />
      <TabLinks
        label="洞见库"
        tabs={[
          { id: "insights", label: `洞见 · ${version.insights.length}` },
          { id: "try", label: "试用" },
          { id: "integrate", label: "接入方式" },
        ]}
        active={active}
        routeOf={(id) => ({ page: "library", id: item.id, tab: id })}
      />
      <div className="tab-panel">
        {active === "insights" ? (
          <div className="stack">
            {categories.map((category) => (
              <Panel key={category} title={category} id={`category-${category}`} flush>
                <ol className="insight-list">
                  {version.insights.filter((insight) => insight.category === category).map((insight) => (
                    <li key={insight.key}>
                      <div className="insight-head"><code>{insight.key}</code></div>
                      <p lang="en">{insight.text}</p>
                    </li>
                  ))}
                </ol>
              </Panel>
            ))}
          </div>
        ) : null}
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
    <div className="stack">
      <Panel title="用这份洞见库解一道新题" id="try-input">
        <div className="try-form">
          <label className="setting">
            <span className="setting-label">模型</span>
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
            </select>
          </label>
          <label className="setting setting--wide">
            <span className="setting-label">题目</span>
            <textarea rows={4} value={question} placeholder="输入一道数学题" onChange={(event) => setQuestion(event.target.value)} />
          </label>
          <div className="try-actions">
            {hasExample ? (
              <button type="button" className="button button--secondary" onClick={() => setQuestion(EXAMPLE.question)}>填入示例题</button>
            ) : null}
            <button type="button" className="button button--primary" disabled={!question.trim()} onClick={() => setRan(question)}>对比：不带库 / 带库</button>
          </div>
        </div>
        <p className="panel-foot">带库时，整份洞见库（{version.insights.length} 条，约 {formatNumber(contextTokens)} token）按 FoT 的解题提示词放进上下文；不带库时只给题目。</p>
      </Panel>

      {ran !== null ? (
        isExample ? (
          <>
            <p className="sample-note" role="note"><Badge tone="sample">示意</Badge><span>以下回答是说明用的示例，不是 {modelLabel(model, state.endpoints)} 的真实输出。</span></p>
            <div className="compare-grid">
              <Panel title="不带洞见库" id="answer-without">
                <pre className="answer" lang="en">{EXAMPLE.without}</pre>
              </Panel>
              <Panel title="带洞见库" id="answer-with" extra={<Badge tone="accent">用到 {EXAMPLE.insight}</Badge>}>
                <pre className="answer" lang="en">{EXAMPLE.with}</pre>
              </Panel>
            </div>
          </>
        ) : (
          <EmptyState title="前端原型没有连接模型">
            接入后端后，这里会并排显示两种方式的回答；题目带标准答案时还会自动判分。
          </EmptyState>
        )
      ) : null}
    </div>
  );
}

function IntegratePanel({ item, version }: { item: Published; version: LibraryVersion }) {
  const preview = JSON.stringify(Object.fromEntries(version.insights.slice(0, 2).map((insight) => [insight.key, insight.text])), null, 2);
  return (
    <div className="stack">
      <Panel title="1 · 导出后放进自己 Agent 的提示词" id="integrate-export" extra={<Badge>现在可用</Badge>}>
        <p className="panel-text">导出的 JSON 与 FoT 运行目录里的 <code>library_r{version.builtAfterRound + 1}.json</code> 格式相同：洞见名 → 描述。</p>
        <pre className="code-block code-block--wrap">{`${preview.slice(0, -2)},\n  …\n}`}</pre>
      </Panel>
      <Panel title="2 · 通过 API 调用" id="integrate-api" extra={<Badge>接入后端后提供</Badge>}>
        <pre className="code-block">{`curl -X POST https://<平台地址>/api/v1/libraries/${item.id}/apply \\
  -H "Authorization: Bearer $FEDAGENT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"question": "…", "model": "openrouter:deepseek/deepseek-chat", "compare": true}'`}</pre>
      </Panel>
      <Panel title="3 · 命令行" id="integrate-cli" extra={<Badge>接入后端后提供</Badge>}>
        <pre className="code-block">{`fedagent apply --library ${item.id} --file questions.jsonl --compare`}</pre>
      </Panel>
      <Note>API 和命令行与界面共用同一套后端接口，权限和审计一致。</Note>
    </div>
  );
}
