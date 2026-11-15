import { useState } from "react";
import type { DemoMatch, DemoUser } from "../../domain/lifestyle/types";
import { SelectField } from "../SelectField";
import { Icon } from "../icons";
import { formatDate } from "../format";
import { Panel } from "../console";

export function AppPreview({users,matches,packageReady,onGenerate,onMatch}: {
  users:readonly DemoUser[];matches:readonly DemoMatch[];packageReady:boolean;onGenerate:()=>void;onMatch:()=>void;
}) {
  const [selected,setSelected] = useState("ls-04");
  const match = matches.find((item) => item.user.id === selected);
  const [opened,setOpened] = useState<string|null>(null);
  const noticeId = match?.status === "attention" ? `${match.packageId}:${selected}` : null;
  const controls = <div className="lifestyle-preview-controls">
      <label htmlFor="lifestyle-preview-user">预览用户</label>
      <SelectField id="lifestyle-preview-user" name="lifestyle-preview-user" value={selected} onValueChange={(id) => {setSelected(id);setOpened(null);}}>
        {users.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}
      </SelectField>
    </div>;
  const emptyTitle = !match ? "尚未运行用户匹配" : match.status === "reported" ? "已有体检结果"
    : match.status === "insufficient" ? "需要补充资料" : "暂无匹配提示";
  return <Panel title="App 提示预览" actions={controls} className="lifestyle-preview-panel">
    <div className="lifestyle-preview-stage">
    <section className="lifestyle-phone" aria-label="LifeStyle App 提示预览">
      <header><span className="lifestyle-app-icon"><Icon name="apps" /></span><div><strong>LifeStyle</strong><span>{users.find((user) => user.id === selected)?.name}</span></div></header>
      <div className="lifestyle-phone-body">
        <h2>健康关注</h2>
        {noticeId && match ? <article className="lifestyle-notification">
          <span className="lifestyle-notification-label"><Icon name="info" />模拟提示</span>
          <h3>有一项健康信息值得核实</h3>
          <p>你的资料符合演示经验的匹配条件，可进一步查看血脂项目的关注提示。</p>
          <time dateTime={match.at}>{formatDate(match.at)}</time>
          <button type="button" className="button button--primary" aria-expanded={opened === noticeId}
            aria-controls={opened === noticeId ? "lifestyle-notice-detail" : undefined} onClick={() => setOpened(opened === noticeId ? null : noticeId)}>{opened === noticeId ? "收起详情" : "查看提示"}</button>
          {opened === noticeId ? <div id="lifestyle-notice-detail" className="lifestyle-notice-detail">
            <h4>为什么收到这条提示</h4><p>当前记录的 BMI 和运动频率符合预设条件；你尚未提供体检结果。</p>
            <h4>接下来可以做什么</h4><p>补充近期体检资料，核实对应项目。这个匹配不代表已经患病。</p>
            <p className="lifestyle-caption">依据：健康关注演示包 · 1 条预设经验。此内容不构成个人医疗建议。</p>
          </div> : null}
        </article> : <div className="lifestyle-preview-empty"><span className="lifestyle-empty-icon"><Icon name={match?.status === "reported" ? "check" : match?.status === "insufficient" ? "alert" : "info"} /></span>
          <h3>{emptyTitle}</h3><p>{!match ? "生成演示经验包并匹配用户后，在这里查看提示。"
          : match.status === "reported" ? "已有模拟体检结果，不重复发送未知结果提示。"
          : match.status === "insufficient" ? "资料不足，请补充体重和运动记录。" : "没有匹配到演示经验，不代表健康状态正常。"}</p>
          {!match ? <button type="button" className="button button--primary" onClick={packageReady ? onMatch : onGenerate}>{packageReady ? "匹配用户" : "生成演示经验包"}</button> : null}
        </div>}
      </div>
    </section>
    </div>
  </Panel>;
}
