import { scenarioOf, type ScenarioId } from "../domain/catalog";

/** 场景是分类而非执行状态；沿用首页蓝／青／紫的场景配色。 */
export function ScenarioTag({ scenario }: { scenario: ScenarioId }) {
  return <span className="tag scenario-tag" data-scenario={scenario}>{scenarioOf(scenario).short}</span>;
}
