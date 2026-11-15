import type { DemoMatch, DemoUser } from "../../domain/lifestyle/types";
import { bmi } from "../../domain/lifestyle/simulation";
import { Panel } from "../console";
import { formatDate } from "../format";
import { MATCH_LABELS } from "./UserList";

export function UserDetail({user,match,onUpload}: {user:DemoUser;match?:DemoMatch;onUpload:()=>void}) {
  return <div className="lifestyle-detail">
    <Panel title="健康资料">
      <dl className="lifestyle-facts">
        {[["年龄",`${user.age} 岁`],["性别",user.sex],["身高",`${user.height} cm`],
          ["体重",user.weight === null ? "未提供" : `${user.weight} kg`],["BMI",bmi(user)?.toFixed(1) ?? "未知"],
          ["每周运动",user.activityDays === null ? "未提供" : `${user.activityDays} 天`],["每晚睡眠",`${user.sleepHours} 小时`],
          ["资料更新",formatDate(user.updatedAt)]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </Panel>
    <Panel title="体检报告" actions={!user.report ? <button type="button" className="button button--secondary button--compact" onClick={onUpload}>模拟上传报告</button> : undefined}>
      {user.report ? <>
        <dl className="lifestyle-facts">
          <div><dt>检测日期</dt><dd>{user.report.examinedAt}</dd></div>
          <div><dt>上传时间</dt><dd>{formatDate(user.report.uploadedAt)}</dd></div>
          <div><dt>甘油三酯</dt><dd>{user.report.value.toFixed(1)} mmol/L</dd></div>
          <div><dt>演示参考范围</dt><dd>0.45–1.70 mmol/L</dd></div>
          <div><dt>模拟标签</dt><dd>{user.report.value > 1.7 ? "偏高" : "范围内"}</dd></div>
        </dl>
        <p className="lifestyle-caption">虚构报告，预设数值仅用于演示流程。</p>
      </> : <p className="lifestyle-caption">尚未上传体检报告。可添加一份预设的虚构报告，查看后续流程。</p>}
    </Panel>
    <Panel title="经验匹配"><p>{match ? MATCH_LABELS[match.status] : "尚未匹配。生成演示经验包后，可返回用户列表运行匹配。"}</p></Panel>
  </div>;
}
