import type { components } from "../../api/schema";
import { Icon } from "../icons";

type Message = components["schemas"]["MessageOut"];
/** 交换摘要与结构化卡片分层，不把完整更新对象直接铺开。 */
export function ExchangeMessage({ message }: { message: Message }) {
  const entries = message.entries ?? [];
  return <li><details className="exchange-message">
    <summary><Icon name="chevron" /><strong title={message.key || undefined}>{message.key || message.category || `消息 ${message.id}`}</strong>
      <span className="muted">第 {message.round} 轮 · 发往{message.receiver === "server" || !message.receiver ? "平台" : message.receiver}</span></summary>
    <div className="exchange-body">
      {entries.length > 1 || entries[0]?.category ? <ul className="exchange-cards">{entries.map((entry, i) => <li key={`${entry.key}:${i}`}>
        <details><summary>{entry.category || "交换内容"} · {entry.key || i + 1}</summary><p lang="en" tabIndex={0} aria-label="经验卡正文">{entry.text}</p></details>
      </li>)}</ul> : <p lang="en" tabIndex={0} aria-label="交换内容正文">{entries[0]?.text ?? message.text}</p>}
    </div>
  </details></li>;
}
