import type { ResourceSpace } from "../../domain/resources";
import { hrefOf, type Route } from "../../state/route";
import { InfoTip } from "../InfoTip";

export function ResourceScope({
  space,
  routeOf,
}: {
  space: ResourceSpace;
  routeOf: (space: ResourceSpace) => Route;
}) {
  return (
    <nav className="resource-space-bar" aria-label="资源归属">
      {(["workspace", "public"] as const).map((value) => (
        <a
          key={value}
          className={`resource-space-link${space === value ? " resource-space-link--active" : ""}`}
          href={hrefOf(routeOf(value))}
          aria-current={space === value ? "page" : undefined}
        >
          {value === "workspace" ? "我的资源" : "公用资源"}
        </a>
      ))}
      <InfoTip label="资源归属">
        当前使用共用工作区，“我的资源”表示工作区接入的资源；尚未提供多用户私有隔离。
      </InfoTip>
    </nav>
  );
}
