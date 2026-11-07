import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../../api/client";
import { consult, type ChatMessage } from "../../api/consultation";
import { isConsultationPackage } from "../../domain/consultation";
import { usableModelOptions } from "../../domain/resources";
import { hrefOf } from "../../state/route";
import type { State } from "../../state/store";
import { PageHead } from "../common";
import { Icon } from "../icons";
import { SelectField } from "../SelectField";

type Message = ChatMessage & { experienceEntries?: number };

function ConversationMessage({ role, content, experienceEntries }: Message) {
  return (
    <article className={`consultation-message consultation-message--${role}`}>
      <strong className={role === "user" ? "visually-hidden" : "consultation-speaker"}>
        {role === "user" ? "你" : "问诊助手"}
      </strong>
      <p>{content}</p>
      {experienceEntries ? <small>本轮提供 {experienceEntries} 条经验</small> : null}
    </article>
  );
}

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
  const historyRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const selected = packages.find((item) => item.id === selection);
  const selectedModel = models.find((item) => item.ref === model);
  const started = Boolean(messages.length || pending);
  const limitReached = messages.length >= 40;
  const canSend = Boolean(selected && selectedModel && input.trim() && !pending && !limitReached);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const shell = inputRef.current?.closest<HTMLElement>(".app-shell");
    if (!viewport || !shell) return;
    // 部分手机键盘只改变可见视口，输入区也要随之缩回键盘上方。
    const resize = () => {
      if (viewport.scale === 1) shell.style.setProperty("--consultation-viewport", `${viewport.height}px`);
      else shell.style.removeProperty("--consultation-viewport");
    };
    resize();
    viewport.addEventListener("resize", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      shell.style.removeProperty("--consultation-viewport");
    };
  }, []);
  useLayoutEffect(() => {
    const history = historyRef.current;
    if (history && followLatest.current) history.scrollTop = history.scrollHeight;
  }, [messages, pending]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!canSend || !selected || request.current) return;
    const text = input.trim();
    const history: ChatMessage[] = messages.map(({ role, content }) => ({ role, content }));
    history.push({ role: "user", content: text });
    const controller = new AbortController();
    request.current = controller;
    followLatest.current = true;
    setPending(text);
    setProblem("");
    try {
      const reply = await consult(selected.id, model, history, controller.signal);
      if (controller.signal.aborted) return;
      setMessages([...messages, { role: "user", content: text },
        { role: "assistant", content: reply.output, experienceEntries: reply.experienceEntries }]);
      setInput("");
    } catch (error) {
      if (!controller.signal.aborted) setProblem(error instanceof ApiError ? error.message : "回答失败，可以重新发送");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending("");
    }
  }

  function startOver() {
    setMessages([]);
    setInput("");
    setProblem("");
    inputRef.current?.focus({ preventScroll: true });
  }

  const sendLabel = problem ? "重新发送" : "发送";
  return (
    <section className={`consultation${started ? "" : " consultation--intro"}`} aria-label="医疗问诊">
      <PageHead className="consultation-head" title="医疗问诊" back={{ label: "应用", route: { page: "apps" } }}
        actions={messages.length ? <button className="button button--ghost" type="button" disabled={Boolean(pending)} onClick={startOver}>
          <Icon name="plus" />新问诊
        </button> : undefined} />
      <div className="consultation-workspace">
        {!started ? (
          <div className="consultation-welcome">
            <span className="consultation-mark"><Icon name="consultation" /></span>
            <h2>今天想咨询什么？</h2>
            <p>可以从主要症状、什么时候开始、有没有变化说起。</p>
          </div>
        ) : (
          <div className="consultation-history" role="log" aria-label="问诊对话" tabIndex={0} ref={historyRef}
            onScroll={(event) => {
              const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
              followLatest.current = scrollHeight - scrollTop - clientHeight < 64;
            }}>
            <div className="consultation-thread">
              {messages.map((message, index) => <ConversationMessage key={index} {...message} />)}
              {pending ? <>
                <ConversationMessage role="user" content={pending} />
                <div className="consultation-waiting" role="status">
                  <span className="consultation-dots" aria-hidden="true"><i /><i /><i /></span>正在回答…
                </div>
              </> : null}
            </div>
          </div>
        )}
        <div className="consultation-input-area">
          {problem ? <p className="consultation-error" role="alert"><Icon name="alert" />{problem}</p> : null}
          {limitReached ? <p className="consultation-note">本次问诊已达 20 轮，可以开启新问诊。</p> : null}
          <form className="consultation-compose" onSubmit={(event) => void send(event)}>
            <label htmlFor="consultation-input" className="visually-hidden">输入问诊问题</label>
            <textarea ref={inputRef} id="consultation-input" value={pending ? "" : input} rows={2} maxLength={4000}
              readOnly={Boolean(pending) || limitReached}
              placeholder={started ? "继续追问或补充信息…" : "描述你想咨询的情况…"}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }} />
            <div className="consultation-toolbar">
              <div className="consultation-picks">
                <SelectField className="consultation-pick" name="consultation-package" aria-label="经验包" value={selected?.id ?? ""}
                  disabled={started || !packages.length} onValueChange={setSelection}>
                  <option value="" disabled>{packages.length ? "选择经验包" : "暂无经验包"}</option>
                  {packages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </SelectField>
                <SelectField className="consultation-pick" name="consultation-model" aria-label="问诊模型" value={selectedModel?.ref ?? ""}
                  disabled={started || !models.length} onValueChange={setModel}>
                  <option value="" disabled>{models.length ? "选择模型" : "暂无可用模型"}</option>
                  {models.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}
                </SelectField>
              </div>
              <button type="submit" className="button button--primary consultation-send" aria-label={sendLabel} title={sendLabel} disabled={!canSend}>
                <Icon name="send" />
              </button>
            </div>
          </form>
          {!packages.length || !models.length ? (
            <div className="consultation-note">
              {!packages.length ? <a href={hrefOf({ page: "tasks" })}>前往联邦任务发布经验包</a> : null}
              {!models.length ? <a href={hrefOf({ page: "models" })}>配置模型接口</a> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
