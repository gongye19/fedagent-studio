import { useState } from "react";
import { demoExperience, demoMatches, demoUsers, packageOutdated } from "../../domain/lifestyle/simulation";
import { navigate, type LifestyleTab } from "../../state/route";
import { Confirm, NotFound, PageHead, TabLinks, Tag } from "../common";
import { AppPreview } from "./AppPreview";
import { ExperiencePanel } from "./ExperiencePanel";
import { UserDetail } from "./UserDetail";
import { UserList } from "./UserList";
import { useLifestyleDemo } from "./useLifestyleDemo";

export function LifestylePage({tab="users",userId}: {tab?:LifestyleTab;userId?:string}) {
  const {session,dispatch,storageError} = useLifestyleDemo();
  const [resetting,setResetting] = useState(false);
  const [message,setMessage] = useState("");
  const users = demoUsers(session), experience = demoExperience(session), matches = demoMatches(session);
  const outdated = packageOutdated(session);
  const user = users.find((item) => item.id === userId);
  function generate() {
    dispatch({type:"generate",at:new Date().toISOString()});
    setMessage("演示经验包已生成。可匹配其他用户并预览提示。");
    navigate({page:"lifestyle",tab:"experience"},{keepScroll:true});
  }
  function match() {
    dispatch({type:"match",at:new Date().toISOString()});
    setMessage("模拟匹配已完成。切换用户可查看不同结果。");
    navigate({page:"lifestyle",tab:"preview"},{keepScroll:true});
  }
  if (userId && !user) return <NotFound kind="演示用户" back={{page:"lifestyle"}} backLabel="LifeStyle" />;
  return <div className="lifestyle-demo">
    <PageHead title={user ? user.name : "LifeStyle"} status={<Tag>交互演示</Tag>}
      back={user ? {label:"LifeStyle",route:{page:"lifestyle"}} : undefined}
      meta="虚构数据与预设规则；未连接 LifeStyle，不运行真实联邦算法或发送推送。"
      actions={!user ? <button type="button" className="button button--secondary" onClick={() => setResetting(true)}>重置演示</button> : undefined} />
    {resetting ? <Confirm title="重置 LifeStyle 演示？" confirmLabel="重置演示" tone="primary" onCancel={() => setResetting(false)}
      onConfirm={() => {dispatch({type:"reset"});setResetting(false);setMessage("");navigate({page:"lifestyle"},{keepScroll:true});}}>仅清除当前浏览器里的模拟上传、演示包和匹配结果。</Confirm> : null}
    {user ? <UserDetail user={user} match={matches.find((item) => item.user.id === user.id)} onUpload={() => {
      dispatch({type:"upload",id:user.id,at:new Date().toISOString()});setMessage("虚构报告已添加，上传时间已更新。");
    }} /> : <>
      <TabLinks<LifestyleTab> label="LifeStyle 功能" active={tab} tabs={[{id:"users",label:"用户资料"},{id:"experience",label:"演示经验包"},{id:"preview",label:"App 提示预览"}]}
        routeOf={(next) => ({page:"lifestyle",tab:next})} />
      <div className="tab-panel">
        {tab === "users" ? <>
          <div className="lifestyle-toolbar"><p>{users.length} 位虚构用户 · {users.filter((item) => item.report).length} 份体检报告</p>
            {!experience || outdated ? <button type="button" className="button button--primary" onClick={generate}>{experience ? "更新演示经验包" : "生成演示经验包"}</button>
              : <button type="button" className="button button--primary" onClick={match}>匹配用户</button>}</div>
          <UserList users={users} matches={matches} />
        </> : tab === "experience" ? <ExperiencePanel experience={experience} outdated={outdated} onGenerate={generate} onMatch={match} />
          : <AppPreview users={users} matches={matches} />}
      </div>
    </>}
    <p className="lifestyle-status" role="status">{storageError ? "当前浏览器无法保存演示状态，刷新后可能丢失。" : message}</p>
  </div>;
}
