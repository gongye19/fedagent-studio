import { useState } from "react";
import { HOSTING_LABELS } from "../../domain/resources";
import { sampleTraceTexts } from "../../domain/sample";
import type { Task } from "../../domain/task";
import { EmptyState, Note, Panel, SampleNote } from "../common";
import { formatNumber } from "../format";

const SHOWN = 3;

export function UploadsTab({ task }: { task: Task }) {
  const rounds = task.rounds.filter((record) => record.traces).map((record) => record.round);
  const [cell, setCell] = useState<{ datasetId: string; round: number } | null>(null);
  if (!rounds.length) {
    return <EmptyState title="还没有上传">第 1 轮的"提取 trace"完成后，这里会列出每个参与方上传的内容。</EmptyState>;
  }
  const active = cell ?? { datasetId: task.members[0].datasetId, round: rounds[rounds.length - 1] };
  const member = task.members.find((item) => item.datasetId === active.datasetId) ?? task.members[0];
  const count = task.rounds.find((record) => record.round === active.round)?.traces?.[member.datasetId] ?? 0;

  return (
    <div className="stack">
      <Note>服务端只收到下面这些 trace。题目、标准答案和解答全文都留在参与方，不上传。</Note>
      <Panel title="每轮上传的 trace 数" id="upload-matrix" flush extra={<small className="muted">点数字查看内容</small>}>
        <div className="table-wrap">
          <table className="table table--numbers">
            <thead>
              <tr>
                <th scope="col">参与方</th>
                <th scope="col">运行位置</th>
                {rounds.map((round) => <th key={round} scope="col" className="numeric">第 {round} 轮</th>)}
              </tr>
            </thead>
            <tbody>
              {task.members.map((item) => (
                <tr key={item.datasetId}>
                  <th scope="row">{item.participant}</th>
                  <td>{HOSTING_LABELS[item.hosting]}</td>
                  {rounds.map((round) => {
                    const value = task.rounds.find((record) => record.round === round)?.traces?.[item.datasetId] ?? 0;
                    const selected = active.datasetId === item.datasetId && active.round === round;
                    return (
                      <td key={round} className="numeric">
                        <button
                          type="button"
                          className={`cell-button${selected ? " cell-button--active" : ""}`}
                          aria-pressed={selected}
                          aria-label={`${item.participant} 第 ${round} 轮上传 ${value} 条 trace`}
                          onClick={() => setCell({ datasetId: item.datasetId, round })}
                        >
                          {formatNumber(value)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title={`${member.participant} · 第 ${active.round} 轮上传的 trace`} id="upload-detail" extra={<small className="muted">共 {formatNumber(count)} 条，展示前 {Math.min(SHOWN, count)} 条</small>}>
        <SampleNote>trace 内容为示例。</SampleNote>
        <ol className="trace-list">
          {sampleTraceTexts(member.datasetId, active.round, Math.min(SHOWN, count)).map((trace) => (
            <li key={trace.key}>
              <code>{trace.key}</code>
              <p lang="en">{trace.text}</p>
            </li>
          ))}
        </ol>
      </Panel>
      <Note>真实多方部署时，参与方可以先在本地审查自己的 trace，确认不含敏感信息后再上传。</Note>
    </div>
  );
}
