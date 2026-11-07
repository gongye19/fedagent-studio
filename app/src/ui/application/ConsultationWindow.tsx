import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../../api/client";
import { consult, type ChatMessage, type ChatReply } from "../../api/consultation";
import type { usableModelOptions } from "../../domain/resources";
import { hrefOf } from "../../state/route";
import { Icon } from "../icons";
import { SelectField } from "../SelectField";

export type WindowSettings = { id: number; packageId: string; model: string };
type Message = ChatMessage & { department?: ChatReply["department"]; experienceEntries?: number };

const OPENING_SUGGESTIONS = [
  "这三天晚上容易咳嗽，白天好一些。",
  "这两天嗓子干，吞咽时有点痛。",
];

function ConversationMessage({ role, content, department, experienceEntries }: Message) {
  return (
    <article className={`consultation-message consultation-message--${role}`}>
      <strong className={role === "user" ? "visually-hidden" : "consultation-speaker"}>
        {role === "user" ? "你" : department ? `${department} · 问诊助手` : "接诊助手"}
      </strong>
      <p>{content}</p>
      {experienceEntries ? <small>本轮提供 {experienceEntries} 条经验</small> : null}
    </article>
  );
}

type Props = {
  window: WindowSettings;
  title: string;
  active: boolean;
  packages: readonly { id: string; name: string }[];
  models: ReturnType<typeof usableModelOptions>;
  closeDisabled: boolean;
  onClose: () => void;
  onStart: () => void;
  onSettings: (values: Partial<Omit<WindowSettings, "id">>) => void;
};

export function ConsultationWindow({
  window, title, active, packages, models, closeDisabled, onClose, onStart, onSettings,
}: Props) {
  const inputId = useId();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState("");
  const [problem, setProblem] = useState("");
  const [started, setStarted] = useState(false);
  const [lastReply, setLastReply] = useState<ChatReply>();
  const request = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const selected = packages.find((item) => item.id === window.packageId);
  const selectedModel = models.find((item) => item.ref === window.model);
  const limitReached = messages.length >= 40;
  const canSend = Boolean(
    selectedModel && (!window.packageId || selected) && input.trim() && !pending && !limitReached,
  );
  const suggestions = lastReply ? lastReply.suggestions : OPENING_SUGGESTIONS;

  useEffect(() => () => request.current?.abort(), []);
  useLayoutEffect(() => {
    const history = historyRef.current;
    if (history && followLatest.current) history.scrollTop = history.scrollHeight;
  }, [active, messages, pending]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!canSend || request.current) return;
    const text = input.trim();
    const history: ChatMessage[] = messages.map(({ role, content }) => ({ role, content }));
    history.push({ role: "user", content: text });
    const controller = new AbortController();
    request.current = controller;
    followLatest.current = true;
    onStart();
    setStarted(true);
    setPending(text);
    setProblem("");
    try {
      const reply = await consult(selected?.id ?? null, window.model, history, controller.signal);
      if (controller.signal.aborted) return;
      setMessages([...messages, { role: "user", content: text }, {
        role: "assistant", content: reply.output, department: reply.department, experienceEntries: reply.experienceEntries,
      }]);
      setLastReply(reply);
      setInput("");
    } catch (error) {
      if (!controller.signal.aborted) setProblem(error instanceof ApiError ? error.message : "回答失败，可以重新发送");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending("");
    }
  }

  const sendLabel = problem ? "重新发送" : "发送";
  return (
    <section id={`consultation-window-${window.id}`} className="consultation-window"
      data-active={active} aria-label={title}>
      <header className="consultation-window-head">
        <div className="consultation-identity">
          <span className="consultation-mark"><Icon name="consultation" /></span>
          <div>
            <h2>{title}</h2>
            <p title="根据对话自动分诊">{lastReply?.department ?? "自动分诊"}</p>
          </div>
        </div>
        <SelectField className="consultation-package" aria-label={`${title}经验包`}
          value={window.packageId} disabled={started} onValueChange={(packageId) => onSettings({ packageId })}>
          <option value="">不加载经验</option>
          {window.packageId && !selected ? <option value={window.packageId} disabled>经验包已不可用</option> : null}
          {packages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </SelectField>
        <button className="button button--ghost consultation-close" type="button" onClick={onClose}
          disabled={closeDisabled} aria-label={`关闭${title}`} title={closeDisabled ? "新建会话后可关闭窗口" : `关闭${title}`}>
          <Icon name="x" />
        </button>
      </header>
      <div className="consultation-history" role="log" aria-label={`${title}对话`} tabIndex={0} ref={historyRef}
        onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          followLatest.current = scrollHeight - scrollTop - clientHeight < 64;
        }}>
        <div className="consultation-thread">
          <ConversationMessage role="assistant" content="你好，最近有什么不舒服？" />
          {messages.map((message, index) => <ConversationMessage key={index} {...message} />)}
          {pending ? <>
            <ConversationMessage role="user" content={pending} />
            <div className="consultation-waiting" role="status">
              <span className="consultation-dots" aria-hidden="true"><i /><i /><i /></span>正在回答…
            </div>
          </> : null}
        </div>
      </div>
      <div className="consultation-input-area">
        <div className="consultation-assist">
          {problem ? <p className="consultation-error" role="alert"><Icon name="alert" />{problem}</p> : null}
          {limitReached ? <p className="consultation-note">本窗口已达 20 轮，可以新建会话。</p> : null}
          {!models.length ? <a className="consultation-note" href={hrefOf({ page: "models" })}>配置模型接口</a> : null}
          {!pending && !limitReached && suggestions.length > 0 ? (
            <div className="consultation-examples" role="group" aria-label={`${title}示例`}>
              <span>{lastReply ? "示例回答" : "示例提问"}</span>
              <div>
                {[...new Set(suggestions)].map((text) => (
                  <button key={text} className="consultation-example" type="button" onClick={() => {
                    setInput(text);
                    inputRef.current?.focus({ preventScroll: true });
                  }}>{text}</button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <form className="consultation-compose" onSubmit={(event) => void send(event)}>
          <label htmlFor={inputId} className="visually-hidden">{title}输入</label>
          <textarea ref={inputRef} id={inputId} value={pending ? "" : input} rows={2} maxLength={4000}
            readOnly={Boolean(pending) || limitReached}
            placeholder={messages.length ? "回复这位问诊助手…" : "描述你想咨询的情况…"}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }} />
          <div className="consultation-toolbar">
            <SelectField className="consultation-pick" aria-label={`${title}模型`} value={selectedModel?.ref ?? ""}
              disabled={started || !models.length} onValueChange={(model) => onSettings({ model })}>
              <option value="" disabled>{models.length ? "选择模型" : "暂无可用模型"}</option>
              {models.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}
            </SelectField>
            <button type="submit" className="button button--primary consultation-send"
              aria-label={`${sendLabel}到${title}`} title={sendLabel} disabled={!canSend}>
              <Icon name="send" />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
