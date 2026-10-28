import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import type { Task } from "../../domain/task";
import { keys } from "../../state/server";
import { Panel } from "../console";
import { SelectField } from "../SelectField";
import { algorithmOfTask } from "../labels";
import { ExchangeMessage } from "./ExchangeMessage";

const PAGE = 25;
export function CommunicationPanel({ task }: { task: Task }) {
  const rounds = task.rounds.filter((r) => r.uploads);
  const [chosen, setChosen] = useState<number | null>(null);
  const [site, setSite] = useState(task.members[0]?.participantId ?? "");
  const round = chosen ?? rounds.at(-1)?.round ?? 1;
  const count = rounds.find((r) => r.round === round)?.uploads?.[site] ?? 0;
  const messages = useInfiniteQuery({
    queryKey: keys.messages(task.id, round, site), initialPageParam: 0,
    queryFn: ({ pageParam }) => api.taskMessages(task.id, { round, site, limit: PAGE, after: pageParam }),
    getNextPageParam: (last) => last.length === PAGE ? last.at(-1)?.id : undefined,
    enabled: count > 0, staleTime: 60_000,
  });
  const rows = messages.data?.pages.flat() ?? [];
  return <Panel title="通信记录" id="uploads" extra={algorithmOfTask(task).exchange}>
    {!rounds.length ? <p className="section-meta">联邦交换完成后，这里显示各方实际上传的内容。</p> : <>
      <div className="process-filters">
        <SelectField aria-label="通信轮次" value={round} onValueChange={(v) => setChosen(Number(v))}>
          {rounds.map((r) => <option value={r.round} key={r.round}>第 {r.round} 轮</option>)}
        </SelectField>
        <SelectField aria-label="通信资源" value={site} onValueChange={setSite}>
          {task.members.map((m) => <option value={m.participantId} key={m.participantId}>{m.agentName || m.participant}</option>)}
        </SelectField><span className="section-meta">{count} 次更新</span>
      </div>
      {!count ? <p className="section-meta">这一轮没有上传</p> : messages.isPending ? <p className="section-meta">正在读取交换内容…</p> : <>
        <ol className="exchange-list">{rows.map((message) => <ExchangeMessage key={message.id} message={message} />)}</ol>
        {messages.isError ? <p className="field-error">读取失败 <button className="link-button" onClick={() => void messages.refetch()}>重试</button></p> : null}
        {messages.hasNextPage && rows.length < count ? <button className="button button--secondary" disabled={messages.isFetchingNextPage} onClick={() => void messages.fetchNextPage()}>{messages.isFetchingNextPage ? "正在读取…" : "加载更多"}</button> : null}
      </>}
    </>}
  </Panel>;
}
