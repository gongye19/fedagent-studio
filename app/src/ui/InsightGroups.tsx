import type { LibraryVersion } from "../domain/task";
import { Tag } from "./common";

/** 按类别分组列出洞见：洞见正文在前，名称作为次要信息放在后面。任务详情和洞见库页共用。 */
export function InsightGroups({ insights, isNew }: { insights: LibraryVersion["insights"]; isNew?: (key: string) => boolean }) {
  const categories = [...new Set(insights.map((insight) => insight.category))];
  return (
    <div className="insight-groups">
      {categories.map((category) => {
        const items = insights.filter((insight) => insight.category === category);
        return (
          <section key={category} className="insight-group" aria-label={category}>
            <h3>{category}<span className="insight-count">{items.length}</span></h3>
            <ol className="insight-list">
              {items.map((insight) => (
                <li key={insight.key}>
                  <p lang="en">{insight.text}</p>
                  <div className="insight-meta">
                    <code>{insight.key}</code>
                    {isNew?.(insight.key) ? <Tag tone="info">新增</Tag> : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
