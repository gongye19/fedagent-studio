import { useEffect, useRef, useState } from "react";
import { ALGORITHMS } from "../../domain/catalog";
import { isConsultationPackage } from "../../domain/consultation";
import { usableModelOptions } from "../../domain/resources";
import type { State } from "../../state/store";
import { PageHead } from "../common";
import { formatNumber } from "../format";
import { Icon } from "../icons";
import { ConsultationWindow, type WindowSettings } from "./ConsultationWindow";

const MAX_WINDOWS = 3;

export function ConsultationPage({ state, packageId }: { state: State; packageId?: string }) {
  const packages = state.published.filter(isConsultationPackage).map((item) => {
    const unit = ALGORITHMS.find((algorithm) => algorithm.id === item.algorithm)?.output.unit ?? "条经验";
    return { id: item.id, name: `${item.name}（${formatNumber(item.items.length)} ${unit}）` };
  });
  const models = usableModelOptions(state.endpoints);
  const [windows, setWindows] = useState<WindowSettings[]>([
    { id: 1, packageId: "", model: "" },
    { id: 2, packageId: packageId ?? "", model: "" },
  ]);
  const [active, setActive] = useState<number | null>(1);
  const [session, setSession] = useState(0);
  const [locked, setLocked] = useState(false);
  const nextId = useRef(3);
  const page = useRef<HTMLElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const addDisabled = locked || windows.length === MAX_WINDOWS;

  useEffect(() => {
    const viewport = window.visualViewport;
    const shell = page.current?.closest<HTMLElement>(".app-shell");
    if (!viewport || !shell) return;
    // 手机键盘有时只改变可见视口。
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

  function addWindow() {
    if (addDisabled) return;
    const id = nextId.current++;
    setWindows([...windows, { id, packageId: "", model: "" }]);
    setActive(id);
  }

  function closeWindow(index: number) {
    if (locked) return;
    if (active === windows[index].id) setActive((windows[index - 1] ?? windows[index + 1])?.id ?? null);
    setWindows(windows.filter((_, position) => position !== index));
    addButton.current?.focus();
  }

  function updateWindow(id: number, values: Partial<Omit<WindowSettings, "id">>) {
    setWindows((previous) => previous.map((item) => item.id === id ? { ...item, ...values } : item));
  }

  function newSession() {
    setSession((previous) => previous + 1);
    setLocked(false);
  }

  return (
    <section className="consultation" aria-label="医疗问诊" ref={page}>
      <PageHead className="consultation-head" title="医疗问诊" back={{ label: "应用", route: { page: "apps" } }}
        actions={<>
          <button ref={addButton} className="button button--ghost" type="button" onClick={addWindow}
            aria-disabled={addDisabled}
            title={locked ? "当前会话已开始，新建会话后可调整窗口" : addDisabled ? "最多 3 个窗口" : undefined}>
            <Icon name="plus" />添加窗口
          </button>
          <button className="button button--primary" type="button" onClick={newSession}
            title="同时重新开始所有窗口的对话">
            <Icon name="plus" />新建会话
          </button>
        </>} />
      <p className="visually-hidden" role="status">
        {locked ? "当前会话已开始，窗口数量已锁定" : `当前有 ${windows.length} 个问诊窗口`}
      </p>
      {windows.length > 1 ? (
        <div className="consultation-window-nav" aria-label="切换问诊窗口" role="group">
          {windows.map((item, index) => (
            <button key={item.id} className="button button--ghost" type="button"
              aria-pressed={active === item.id} aria-controls={`consultation-window-${item.id}`}
              onClick={() => setActive(item.id)}>问诊 {index + 1}</button>
          ))}
        </div>
      ) : null}
      <div className="consultation-workspace" data-count={windows.length}>
        {windows.length === 0 ? <p className="consultation-empty">点击「添加窗口」开始问诊。</p> : null}
        {windows.map((item, index) => (
          <ConsultationWindow key={`${session}:${item.id}`} window={item} title={`问诊 ${index + 1}`}
            active={item.id === active} packages={packages} models={models}
            closeDisabled={locked}
            onClose={() => closeWindow(index)} onStart={() => setLocked(true)}
            onSettings={(values) => updateWindow(item.id, values)} />
        ))}
      </div>
    </section>
  );
}
