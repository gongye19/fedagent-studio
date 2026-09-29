import type { LibraryVersion } from "../domain/task";
import { Tag } from "./common";

/** 按类别分组列出产出里的条目（FoT 是经验库里的经验），任务产出和应用内容共用。条目的内部编号只在导出的 JSON 里，页面上不显示。 */
export function InsightGroups({
  insights, isNew, level = 3,
}: {
  insights: LibraryVersion["insights"];
  isNew?: (key: string) => boolean;
  /** 类别标题的层级：放在区块标题下面时是 h3，直接放在页面标题下面时是 h2。 */
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  const categories = [...new Set(insights.map((insight) => insight.category))];
  return (
    <div className="insight-groups">
      {categories.map((category) => {
        const items = insights.filter((insight) => insight.category === category);
        return (
          <section key={category} className="insight-group" aria-label={category}>
            <Heading className="insight-heading">{category}<span className="insight-count">{items.length}</span></Heading>
            <ol className="insight-list">
              {items.map((insight) => (
                <li key={insight.key}>
                  <p lang="en">{insight.text}{isNew?.(insight.key) ? <> <Tag tone="info">新增</Tag></> : null}</p>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
