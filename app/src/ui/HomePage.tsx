import { SCENARIOS } from "../domain/catalog";
import { hrefOf } from "../state/route";
import { Facts, PageHead, Tag } from "./common";
import { Panel } from "./console";
import { Icon } from "./icons";

/** 平台里的几个概念，分开说清楚：场景、任务类型、算法来自注册表，参与方、数据集由用户登记，联邦任务把它们组合起来。 */
const TERMS: readonly (readonly [string, string])[] = [
  ["场景", "各方的数据怎么分布，分横向、纵向、迁移三种。"],
  ["任务类型", "Agent 要做的事，例如数学推理；决定数据格式和评估指标。"],
  ["算法", "各方怎么协作，例如 FoT；每个算法只属于一个场景。"],
  ["参与方", "参加联邦的机构或节点，原始数据不出本方。"],
  ["数据集", "属于某个参与方，登记时选定场景和任务类型。"],
  ["联邦任务", "选定场景、任务类型和算法，几个参与方各出一份数据集，协作几轮。"],
];

/**
 * 一个联邦任务从头到尾怎么走：每步一个标题、一句说明。
 * 中文只在标点处换行，说明里每一段都不超过 14 个字，排成四栏时每栏放得下。
 */
const STEPS: readonly { title: string; text: string }[] = [
  { title: "登记参与方和数据集", text: "先登记参与方，再为它登记数据集；登记时选好场景和任务类型。" },
  { title: "新建联邦任务", text: "依次选场景、任务类型和算法，再勾选参与方，每方出一份匹配的数据集。" },
  { title: "协作几轮", text: "每轮各方先用自己的数据作答，再把交换内容发给服务端汇总，汇总结果在下一轮发回各方。" },
  { title: "看效果、发布应用", text: "看各方联邦前后的效果变化，把产出发布为应用，接入自己的 Agent。" },
];

/**
 * 首页只放别的页面没有的内容：三种联邦场景各是什么、几个概念的区别，和一个联邦任务怎么进行。
 * 任务、参与方、数据集、接口、应用的列表和数量都在各自的页面里，入口在侧栏，这里不重复；
 * 新建联邦任务只在页头放一个按钮。
 */
export default function HomePage() {
  return (
    <>
      <PageHead
        title="首页"
        meta="让多个参与方的 Agent 一起变强：各方之间不交换原始数据，只交换算法需要的内容。"
        actions={<a className="button button--primary" href={hrefOf({ page: "newTask" })}><Icon name="plus" />新建联邦任务</a>}
      />

      <div className="scenario-grid">
        {SCENARIOS.map((scenario) => (
          <section key={scenario.id} className="panel scenario-tile" aria-labelledby={`scenario-${scenario.id}`}>
            <div className="scenario-tile-head">
              <h2 id={`scenario-${scenario.id}`}>{scenario.name}</h2>
              {scenario.status === "available" ? null : <Tag>规划中</Tag>}
            </div>
            <p>{scenario.summary}</p>
          </section>
        ))}
      </div>

      <Panel title="几个概念" id="terms">
        <Facts className="facts--columns terms" items={TERMS} />
      </Panel>

      <Panel title="一个联邦任务怎么进行" id="flow" className="flow-panel">
        <ol className="flow-steps">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span className="flow-index" aria-hidden="true">{index + 1}</span>
              <div className="flow-copy">
                <strong>{step.title}</strong>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </>
  );
}
