import type { DemoMatch, DemoUser } from "../../domain/lifestyle/types";
import { hrefOf } from "../../state/route";
import { Tag } from "../common";
import { formatDate } from "../format";
import { ResourceTable } from "../resources/ResourceTable";

export const MATCH_LABELS = {attention:"有新提示",unmatched:"未匹配经验",insufficient:"待补充资料",reported:"已有实测结果"} as const;

export function UserList({users,matches}: {users:readonly DemoUser[];matches:readonly DemoMatch[]}) {
  return <ResourceTable label="LifeStyle 演示用户" className="lifestyle-users" columns={[
    {label:"用户",width:"16%"},{label:"资料更新",width:"20%"},{label:"体检报告",width:"14%"},
    {label:"报告上传时间",width:"20%"},{label:"经验匹配",width:"18%"},{label:"操作",width:"12%",className:"numeric"},
  ]} empty={false} emptyContent={null}>
    {users.map((user) => {
      const match = matches.find((item) => item.user.id === user.id);
      return <tr key={user.id}>
        <th scope="row">{user.name}</th>
        <td data-label="资料更新"><time dateTime={user.updatedAt}>{formatDate(user.updatedAt)}</time></td>
        <td data-label="体检报告">{user.report ? "已上传" : <span className="muted">未上传</span>}</td>
        <td data-label="报告上传时间">{user.report ? <time dateTime={user.report.uploadedAt}>{formatDate(user.report.uploadedAt)}</time> : <span className="muted">—</span>}</td>
        <td data-label="经验匹配">{match?.status === "attention" ? <Tag tone="info">有新提示</Tag> : <span className="muted">{match ? MATCH_LABELS[match.status] : "未匹配"}</span>}</td>
        <td className="numeric cell-action" data-label="操作"><a className="button button--secondary button--compact"
          aria-label={`查看${user.name}资料`} href={hrefOf({page:"lifestyle",userId:user.id})}>查看</a></td>
      </tr>;
    })}
  </ResourceTable>;
}
