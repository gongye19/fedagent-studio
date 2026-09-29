import { SCENARIOS } from "../domain/catalog";
import { hrefOf } from "../state/route";
import { PageHead, Tag } from "./common";
import { Panel } from "./console";
import { Icon } from "./icons";

/**
 * 一个联邦任务从头到尾怎么走：每步一个标题、一句说明。
 * 中文只在标点处换行，说明里每一段都不超过 14 个字，排成四栏时每栏放得下。
 */
const STEPS: readonly { title: string; text: string }[] = [
  { title: "登记参与方", text: "每个参与方带自己的数据集，可以上传到平台托管，也可以留在本地。" },
  { title: "新建联邦任务", text: "依次选场景、任务类型、算法和参与方，再设好轮次和模型。" },
  { title: "协作几轮", text: "每轮各方先用自己的数据作答，再把交换内容发给服务端汇总，汇总结果在下一轮发回各方。" },
  { title: "看效果、发布应用", text: "看各方联邦前后的效果变化，把产出发布为应用，接入自己的 Agent。" },
];

/**
 * 首页只放别的页面没有的内容：三种联邦场景各是什么，和一个联邦任务怎么进行。
 * 任务、参与方、接口、应用的列表和数量都在各自的页面里，入口在侧栏，这里不重复；
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
