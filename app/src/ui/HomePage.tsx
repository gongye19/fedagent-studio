import { SCENARIOS } from "../domain/catalog";
import { hrefOf } from "../state/route";
import { PageHead, Tag } from "./common";
import { Icon } from "./icons";

/**
 * 首页只放三个大选项：横向、纵向、迁移三种联邦场景。
 * 可用的场景整张卡片都能点，点进去就是这个场景的联邦任务配置；规划中的场景灰显、不能点。
 * 任务、参与方、数据集、接口、应用都在各自的页面里，入口在侧栏，这里不重复。
 */
export default function HomePage() {
  return (
    <>
      <PageHead title="首页" meta="选择一种联邦场景，进入后配置这个场景的联邦任务。" />
      {/* 按内容区宽度决定三张并排还是上下排，见 styles.css */}
      <div className="scenario-picker">
        <ul className="scenario-list" aria-label="联邦场景">
          {SCENARIOS.map((scenario) => (
            <li key={scenario.id}>
              {scenario.status === "available" ? (
                <a className="scenario-card" href={hrefOf({ page: "newTask", scenario: scenario.id })}>
                  <span className="scenario-card-head">
                    <strong>{scenario.name}</strong>
                    <Icon name="arrow" />
                  </span>
                  <span className="scenario-card-text">{scenario.summary}</span>
                </a>
              ) : (
                <div className="scenario-card scenario-card--planned">
                  <span className="scenario-card-head">
                    <strong>{scenario.name}</strong>
                    <Tag>规划中</Tag>
                  </span>
                  <span className="scenario-card-text">{scenario.summary}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
