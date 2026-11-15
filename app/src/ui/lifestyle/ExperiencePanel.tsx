import type { DemoExperience } from "../../domain/lifestyle/types";
import { Panel } from "../console";
import { formatDate } from "../format";
import { PanelEmpty, Tag } from "../common";

export function ExperiencePanel({experience,outdated,onGenerate,onMatch}: {
  experience:DemoExperience|null;outdated:boolean;onGenerate:()=>void;onMatch:()=>void;
}) {
  if (!experience) return <Panel title="演示经验包"><PanelEmpty>
    <p>已有 3 份虚构体检报告，可以开始演示。</p>
    <button type="button" className="button button--primary" onClick={onGenerate}>生成演示经验包</button>
  </PanelEmpty></Panel>;
  return <div className="lifestyle-detail">
    <Panel title="健康关注经验包" extra={<Tag>模拟产物</Tag>} actions={outdated
      ? <button type="button" className="button button--primary" onClick={onGenerate}>重新生成演示包</button>
      : <button type="button" className="button button--primary" onClick={onMatch}>匹配用户</button>}>
      <dl className="lifestyle-package-meta">
        <div><dt>来源报告</dt><dd>{experience.sources.length} 份</dd></div>
        <div><dt>演示经验</dt><dd>1 条</dd></div>
        <div><dt>生成时间</dt><dd>{formatDate(experience.createdAt)}</dd></div>
      </dl>
      {outdated ? <p className="lifestyle-caption" role="status">有新的可用报告，重新生成后再匹配用户。</p> : null}
    </Panel>
    <Panel title="血脂项目关注" extra={<Tag>预设规则</Tag>}>
      <div>
        <p>BMI ≥ 25，且每周运动不超过 1 天。</p>
        <p className="lifestyle-caption">匹配条件用于演示交互，不是经验证的医学规则，也不是 FoT 的实际算法输出。</p>
      </div>
      <dl className="lifestyle-package-meta">
        <div><dt>模拟结果偏高</dt><dd>{experience.supporting} 人</dd></div>
        <div><dt>模拟结果范围内</dt><dd>{experience.counterexamples} 人</dd></div>
      </dl>
      <p className="lifestyle-caption">来源：{experience.sources.map((user) => user.name).join("、")}。保留反例，不把相似情况视为相同结果。</p>
    </Panel>
  </div>;
}
