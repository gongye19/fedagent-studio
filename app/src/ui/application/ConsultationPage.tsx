import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../../api/client";
import { consult, type ChatMessage } from "../../api/consultation";
import { isConsultationPackage } from "../../domain/consultation";
import { usableModelOptions } from "../../domain/resources";
import { hrefOf } from "../../state/route";
import type { State } from "../../state/store";
import { PageHead } from "../common";
import { Panel } from "../console";
import { SelectField } from "../SelectField";

type Message = ChatMessage & { experienceEntries?: number };

export function ConsultationPage({ state, packageId }: { state: State; packageId?: string }) {
  const packages = state.published.filter(isConsultationPackage);
  const models = usableModelOptions(state.endpoints);
  const [selection, setSelection] = useState(packageId ?? "");
  const [model, setModel] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState("");
  const [problem, setProblem] = useState("");
  const request = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const selected = packages.find((item) => item.id === selection);
  const canSend = Boolean(selected && models.some((item) => item.ref === model) && input.trim() && !pending && messages.length < 40);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (messages.length || pending) bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages, pending]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!canSend || !selected || request.current) return;
    const text = input.trim();
    const history: ChatMessage[] = messages.map(({ role, content }) => ({ role, content }));
    history.push({ role: "user", content: text });
    const controller = new AbortController();
    request.current = controller;
    setPending(text);
    setProblem("");
    try {
      const reply = await consult(selected.id, model, history, controller.signal);
      setMessages([...messages, { role: "user", content: text },
        { role: "assistant", content: reply.output, experienceEntries: reply.experienceEntries }]);
      setInput("");
    } catch (error) {
      if (!controller.signal.aborted) setProblem(error instanceof ApiError ? error.message : "回答失败，可以重新发送");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) {
        setPending("");
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  }

  return (
    <>
      <PageHead title="医疗问诊" back={{ label: "应用", route: { page: "apps" } }} meta="选择问诊经验包，描述情况并继续追问。" />
      <Panel className="consultation">
        <div className="consultation-controls">
          <label className="consultation-field">
            <span>经验包</span>
            <SelectField name="consultation-package" aria-label="经验包" value={selected?.id ?? ""}
              disabled={Boolean(pending || messages.length || !packages.length)} onValueChange={setSelection}>
              <option value="" disabled>{packages.length ? "选择经验包" : "暂无可用经验包"}</option>
              {packages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </SelectField>
          </label>
          <label className="consultation-field">
            <span>问诊模型</span>
            <SelectField name="consultation-model" aria-label="问诊模型" value={model}
              disabled={Boolean(pending || messages.length || !models.length)} onValueChange={setModel}>
              <option value="" disabled>选择模型</option>
              {models.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}
            </SelectField>
          </label>
          <button className="button button--secondary" type="button" disabled={Boolean(pending || !messages.length)}
            onClick={() => { setMessages([]); setInput(""); setProblem(""); inputRef.current?.focus(); }}>新问诊</button>
        </div>
        {!models.length ? <p className="muted">需要一个可用的问诊模型。<a href={hrefOf({ page: "models" })}>配置模型接口</a></p> : null}
        <div className="consultation-history" role="log" aria-label="问诊对话">
          {!messages.length && !pending ? (
            <div className="consultation-empty">
              <strong>{packages.length ? "描述想咨询的情况" : "先准备一个问诊经验包"}</strong>
              {packages.length ? <p>可以从主要症状和持续时间说起。</p> :
                <a className="button button--secondary" href={hrefOf({ page: "tasks" })}>查看联邦任务</a>}
            </div>
          ) : null}
          {messages.map((message, index) => (
            <article key={index} className={`consultation-message consultation-message--${message.role}`}>
              <strong>{message.role === "user" ? "你" : "问诊助手"}</strong>
              <p>{message.content}</p>
              {message.experienceEntries ? <small>本轮向模型提供 {message.experienceEntries} 条经验</small> : null}
            </article>
          ))}
          {pending ? <>
            <article className="consultation-message consultation-message--user"><strong>你</strong><p>{pending}</p></article>
            <p className="muted" role="status">正在回答…</p>
          </> : null}
          <div ref={bottom} />
        </div>
        <form className="consultation-compose" onSubmit={(event) => void send(event)}>
          {problem ? <p className="field-error" role="alert">{problem}</p> : null}
          {messages.length >= 40 ? <p className="muted">本次问诊已达 20 轮，可以开启新问诊。</p> : null}
          <label htmlFor="consultation-input" className="visually-hidden">输入问诊问题</label>
          <textarea ref={inputRef} id="consultation-input" value={input} rows={2} maxLength={4000} disabled={Boolean(pending)}
            placeholder="输入问题或补充信息…" onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }} />
          <div className="consultation-send"><button className="button button--primary" disabled={!canSend}>发送</button></div>
        </form>
      </Panel>
    </>
  );
}
