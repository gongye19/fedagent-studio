import { Fragment } from "react";
import { ALGORITHMS, algorithmsFor, defaultParams, paramText, scenarioOf, SCENARIOS, TASK_TYPES, type Algorithm } from "../domain/catalog";
import { navigate } from "../state/route";
import { Facts, PageHead, Tag } from "./common";
import { Panel } from "./console";
import { Icon } from "./icons";

/**
 * 算法：注册表里登记的算法。每行点开看这个算法每轮做什么、有哪些参数、出自哪里；
 * 还没有算法的场景合成一行写"待接入"。
 */
export default function AlgorithmsPage({ selectedId }: { selectedId?: string }) {
  const planned = SCENARIOS.filter((scenario) => !algorithmsFor(scenario.id).length);
  const toggle = (id: string) => navigate(selectedId === id ? { page: "algorithms" } : { page: "algorithms", id }, { keepScroll: true });
  return (
    <>
      <PageHead title="算法" />
      <Panel flush>
        <div className="table-shell">
          <table className="table table--rows">
            <thead>
              <tr>
                <th scope="col">算法</th>
                <th scope="col">场景</th>
                <th scope="col" className="col-optional">任务类型</th>
                <th scope="col" className="col-optional">通信内容</th>
                <th scope="col">产出</th>
              </tr>
            </thead>
            <tbody>
              {ALGORITHMS.map((algorithm) => {
                const open = selectedId === algorithm.id;
                return (
                  <Fragment key={algorithm.id}>
                    <tr
                      className={`row--toggle${open ? " row--open" : ""}`}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("button, a")) return;
                        toggle(algorithm.id);
                      }}
                    >
                      <th scope="row">
                        <button type="button" className="row-button" aria-expanded={open} onClick={() => toggle(algorithm.id)}>
                          <Icon name="chevron" />
                          <span className="cell-title">{algorithm.name}<span className="cell-note" translate="no">{algorithm.fullName}</span></span>
                        </button>
                      </th>
                      <td>{scenarioOf(algorithm.scenario).short}</td>
                      <td className="col-optional">{algorithm.accepts.map((type) => TASK_TYPES[type].label).join("、")}</td>
                      <td className="col-optional">{algorithm.exchange}</td>
                      <td>{algorithm.output.name}</td>
                    </tr>
                    {open ? (
                      <tr className="detail-row">
                        <td colSpan={5}><AlgorithmDetail algorithm={algorithm} /></td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {planned.length ? (
                <tr className="row--muted">
                  <td colSpan={5}>
                    <span className="cell-title">{planned.map((scenario) => scenario.short).join("、")}：算法待接入<Tag>规划中</Tag></span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function AlgorithmDetail({ algorithm }: { algorithm: Algorithm }) {
  const side = (which: "participant" | "server") => algorithm.stages.filter((stage) => stage.side === which).map((stage) => stage.label).join(" → ");
  return (
    <div className="participant-detail">
      <p className="detail-lede">{algorithm.summary}</p>
      <Facts className="facts--columns" items={[
        ["参与方每轮", side("participant")],
        ["服务端每轮", side("server")],
        ["参与方", `至少 ${algorithm.minParticipants} 个`],
        ["轮次", `${algorithm.minRounds}–${algorithm.maxRounds} 轮，第 1 轮是本地基线`],
        ...algorithm.params.map((def) => [def.label, `默认：${paramText(def, defaultParams(algorithm)).replace(/（默认）$/, "")}`] as const),
        ["来源", <a key="paper" className="text-link" href={algorithm.source.paperUrl} target="_blank" rel="noreferrer">论文 {algorithm.source.paper}</a>],
      ]} />
    </div>
  );
}
