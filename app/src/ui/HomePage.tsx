import { SCENARIOS } from "../domain/catalog";
import { hrefOf } from "../state/route";
import { PageHead, Tag } from "./common";
import { Icon } from "./icons";
import { ScenarioArt } from "./ScenarioArt";

/**
 * 首页只放三个大选项：横向、纵向、迁移三种联邦场景，居中排列。
 * 每张卡片上一张示意图说明这种场景怎么分数据；可用的场景整张卡片都能点，点进去就是这个场景的联邦任务配置，
 * 规划中的场景灰显、不能点。任务、参与方、接口、应用都在各自的页面里，入口在侧栏，这里不重复。
 */
export default function HomePage() {
  return (
    <div className="home">
      <PageHead title="选择联邦场景" meta="点一种场景，进入后配置这个场景的联邦任务。" className="page-head--center" />
      {/* 按内容区宽度决定三张并排还是上下排，见 styles.css */}
      <div className="scenario-picker">
        <ul className="scenario-list" aria-label="联邦场景">
          {SCENARIOS.map((scenario) => {
            const available = scenario.status === "available";
            const body = (
              <>
                <span className="scenario-art"><ScenarioArt scenario={scenario.id} /></span>
                <span className="scenario-card-body">
                  <span className="scenario-card-head">
                    <strong>{scenario.name}</strong>
                    {available ? null : <Tag>规划中</Tag>}
                  </span>
                  <span className="scenario-card-text">{scenario.summary}</span>
                  {available ? <span className="scenario-card-go">开始配置<Icon name="arrow" /></span> : null}
                </span>
              </>
            );
            return (
              <li key={scenario.id}>
                {available
                  ? <a className={`scenario-card scenario-card--${scenario.id}`} href={hrefOf({ page: "newTask", scenario: scenario.id })}>{body}</a>
                  : <div className={`scenario-card scenario-card--${scenario.id} scenario-card--planned`}>{body}</div>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
