import { useEffect, useRef, useState } from "react";
import type { Algorithm } from "../../domain/catalog";
import { Panel } from "../console";
import { Facts } from "../common";
import { loadDiagramSource } from "./source";
import { ALGORITHM_GUIDES, type AlgorithmGuide } from "./guides";

export function AlgorithmFlow({algorithm}: {algorithm: Algorithm}) {
  const guide = ALGORITHM_GUIDES[algorithm.id];
  return guide ? <FlowPanel key={algorithm.id} algorithm={algorithm} guide={guide} /> : <StepList algorithm={algorithm} />;
}

function FlowPanel({algorithm, guide}: {algorithm: Algorithm; guide: AlgorithmGuide}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [mobile, setMobile] = useState(() => matchMedia("(max-width: 640px)").matches);
  const [playing, setPlaying] = useState(() => !matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [html, setHtml] = useState<string>();
  const [visible, setVisible] = useState(true);
  const stacked = useRef(mobile);
  const dimensions = mobile ? guide.mobile : guide.desktop;
  const url = `/algorithm-diagrams/${algorithm.id}${mobile ? "-mobile" : ""}.html?v=${dimensions.sha256}&attempt=${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    void loadDiagramSource(url, controller.signal).then((source) => {
      if (!controller.signal.aborted) setHtml(source);
    }).catch(() => { if (!controller.signal.aborted) setPhase("error"); });
    return () => controller.abort();
  }, [url]);

  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const onReduced = () => { if (reduced.matches) setPlaying(false); };
    reduced.addEventListener("change", onReduced);
    return () => reduced.removeEventListener("change", onReduced);
  }, []);

  useEffect(() => {
    const onReady = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && event.data?.type === "fedagent-diagram-ready") setPhase("ready");
    };
    window.addEventListener("message", onReady);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    const resize = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width < 680;
      if (stacked.current !== next) {
        stacked.current = next;
        setPhase("loading");
        setHtml(undefined);
        setMobile(next);
      }
    });
    if (wrapper.current) observer.observe(wrapper.current);
    if (wrapper.current?.parentElement) resize.observe(wrapper.current.parentElement);
    return () => { window.removeEventListener("message", onReady); observer.disconnect(); resize.disconnect(); };
  }, []);

  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setTimeout(() => setPhase("error"), 10000);
    return () => window.clearTimeout(timer);
  }, [phase, mobile, attempt]);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({type: "fedagent-diagram-control", playing, visible}, "*");
  }, [playing, visible, phase]);

  return (
    <Panel title="架构流程" extra="平台流程 · 非实时示意" actions={
      <button type="button" className="button button--ghost button--compact" disabled={phase !== "ready"}
        data-playing={playing} onClick={() => setPlaying((value) => !value)}>{playing ? "暂停动画" : "播放动画"}</button>
    }>
      <div ref={wrapper} className={`algorithm-diagram${mobile ? " algorithm-diagram--stacked" : ""}`} aria-busy={phase === "loading"}
        style={{aspectRatio: `${dimensions.width} / ${dimensions.height}`}}>
        <iframe key={url} ref={frame} title={`${algorithm.name} 架构流程示意图`} sandbox="allow-scripts" tabIndex={-1}
          srcDoc={html}
          onError={() => setPhase("error")} />
        {phase === "loading" ? <div className="algorithm-diagram-state" role="status">正在加载流程图…</div> : null}
        {phase === "error" ? <div className="algorithm-diagram-state" role="alert">
          <p>流程图暂时无法加载，可在下方查看文字步骤。</p>
          <button type="button" className="button button--secondary button--compact" onClick={() => { setPhase("loading"); setHtml(undefined); setAttempt((value) => value + 1); }}>重新加载</button>
        </div> : null}
      </div>
      <details className="algorithm-explanation">
        <summary>算法说明</summary>
        <Facts items={[["做什么", guide.purpose], ["需要什么", guide.resources], ["如何运行", guide.process]]} />
        <p className="algorithm-scope">{guide.integration}</p>
      </details>
    </Panel>
  );
}

function StepList({algorithm}: {algorithm: Algorithm}) {
  const steps = <div className="algo-steps">{(["participant", "server"] as const).map((side) => (
    <div className="algo-steps-group" key={side}>
      <h3>{side === "participant" ? "参与方" : "服务端"}</h3>
      <ol>{algorithm.stages.filter((stage) => stage.side === side).map((stage) => (
        <li key={stage.id}><span className="algo-step-index" aria-hidden="true">{algorithm.stages.indexOf(stage) + 1}</span><span>{stage.label}</span></li>
      ))}</ol>
    </div>
  ))}</div>;
  return <Panel title="每轮步骤" extra={`共 ${algorithm.stages.length} 步`}>{steps}</Panel>;
}
