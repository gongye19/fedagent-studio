import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../../api/client";
import { consult, type ChatMessage, type ChatReply, type ConsultationSample } from "../../api/consultation";
import type { usableModelOptions } from "../../domain/resources";
import { hrefOf } from "../../state/route";
import { Tag } from "../common";
import { Icon } from "../icons";
import { SelectField } from "../SelectField";
import { sampleProgress } from "./consultationSamples";

export type WindowSettings = { id: number; packageId: string; model: string };
type Message = ChatMessage & { department?: ChatReply["department"]; experienceEntries?: number };

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
  samples: readonly ConsultationSample[];
  closeDisabled: boolean;
  onClose: () => void;
  onStart: () => void;
  onSettings: (values: Partial<Omit<WindowSettings, "id">>) => void;
};

export function ConsultationWindow({
  window, title, active, packages, models, samples, closeDisabled, onClose, onStart, onSettings,
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
  const selectedModel = models.find((item) => item.ref === window.model) ?? (started ? undefined : models[0]);
  const final = lastReply?.final;
  const limitReached = messages.length >= 40;
  const canSend = Boolean(
    selectedModel && (!window.packageId || selected) && input.trim() && !pending && !limitReached && !final,
  );
  const sample = sampleProgress(messages, samples);
  const nextSample = sample?.next;
  const showDemo = !pending && !limitReached && !final;
  const finalTurn = sample && nextSample && sample.sent === sample.total - 1;

  function fill(text: string) {
    setInput(text);
    inputRef.current?.focus({ preventScroll: true });
  }

  useEffect(() => () => request.current?.abort(), []);
  useLayoutEffect(() => {
    const history = historyRef.current;
    if (history && followLatest.current) history.scrollTop = history.scrollHeight;
  }, [active, messages, pending]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!canSend || !selectedModel || request.current) return;
    const text = input.trim();
    const history: ChatMessage[] = messages.map(({ role, content }) => ({ role, content }));
    history.push({ role: "user", content: text });
    const controller = new AbortController();
    request.current = controller;
    followLatest.current = true;
    if (window.model !== selectedModel.ref) onSettings({ model: selectedModel.ref });
    onStart();
    setStarted(true);
    setPending(text);
    setProblem("");
    try {
      const reply = await consult(selected?.id ?? null, selectedModel.ref, history, controller.signal);
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
              <span className="consultation-dots" aria-hidden="true"><i /><i /><i /></span>{finalTurn && pending === nextSample.text ? "正在生成并核对最终诊断…" : "正在回答…"}
            </div>
          </> : null}
        </div>
      </div>
      <div className="consultation-input-area">
        <div className="consultation-assist">
          {problem ? <p className="consultation-error" role="alert"><Icon name="alert" />{problem}</p> : null}
          {limitReached ? <p className="consultation-note">本窗口已达 20 轮，可以新建会话。</p> : null}
          {!models.length ? <a className="consultation-note" href={hrefOf({ page: "models" })}>配置模型接口</a> : null}
          {showDemo && !messages.length && samples.length ? (
            <div className="consultation-examples" role="group" aria-label={`${title}演示病例`}>
              <span>演示病例</span>
              <div>
                {samples.map(({ turns: [first], packageName }) => first ? (
                  <button key={first.text} className="consultation-example" type="button"
                    aria-pressed={input === first.text} onClick={() => fill(first.text)}>
                    <span>{first.label}</span><small>对照 {packageName}</small>
                  </button>
                ) : null)}
              </div>
            </div>
          ) : null}
          {showDemo && sample && nextSample ? (
            <div className="consultation-examples" role="group" aria-label={`${title}下一条演示资料`}>
              <span>第 {sample.sent + 1}/{sample.total} 步</span>
              <div><button className="consultation-example" type="button" onClick={() => fill(nextSample.text)}>
                {nextSample.label}
                {finalTurn ? <small>发送后生成最终诊断</small> : null}
              </button></div>
            </div>
          ) : null}
        </div>
        {final ? <div className="consultation-diagnosis" role="status">
          <div className="consultation-diagnosis-heading">
            <strong>演示最终诊断</strong>
            <Tag tone={final.matched === true ? "success" : final.matched === false ? "danger" : "neutral"}>
              {final.matched === true ? "匹配参考诊断" : final.matched === false ? "未匹配参考诊断" : "暂未判定"}
            </Tag>
          </div>
          <p className="consultation-diagnosis-value">{final.diagnosis}</p>
          <p className="consultation-note">{final.caseLabel} · 参考诊断 {final.reference}</p>
        </div> : <form className="consultation-compose" onSubmit={(event) => void send(event)}>
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
              <option value="" disabled>{started ? "当前模型不可用" : "暂无可用模型"}</option>
              {models.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}
            </SelectField>
            <button type="submit" className="button button--primary consultation-send"
              aria-label={`${sendLabel}到${title}`} title={sendLabel} disabled={!canSend}>
              <Icon name="send" />
            </button>
          </div>
        </form>}
      </div>
    </section>
  );
}
