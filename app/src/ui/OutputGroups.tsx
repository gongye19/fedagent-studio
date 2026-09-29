import type { OutputItem } from "../domain/task";
import { Tag } from "./common";

/** 按类别分组列出产出里的条目（FoT 是经验库里的经验），任务产出和应用内容共用。条目的内部编号只在导出的 JSON 里，页面上不显示。 */
export function OutputGroups({
  items, isNew, level = 3,
}: {
  items: readonly OutputItem[];
  isNew?: (key: string) => boolean;
  /** 类别标题的层级：放在区块标题下面时是 h3，直接放在页面标题下面时是 h2。 */
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  const categories = [...new Set(items.map((item) => item.category))];
  return (
    <div className="output-groups">
      {categories.map((category) => {
        const inCategory = items.filter((item) => item.category === category);
        return (
          <section key={category} className="output-group" aria-label={category}>
            <Heading className="output-heading">{category}<span className="output-count">{inCategory.length}</span></Heading>
            <ol className="output-list">
              {inCategory.map((item) => (
                <li key={item.key}>
                  <p lang="en">{item.text}{isNew?.(item.key) ? <> <Tag tone="info">新增</Tag></> : null}</p>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
