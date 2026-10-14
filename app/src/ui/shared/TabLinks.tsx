import { useLayoutEffect, useRef, type ReactNode } from "react";
import { hrefOf, type Route } from "../../state/route";

/** 链接式标签页：每个标签是一个地址，刷新后停在同一页。 */
export function TabLinks<T extends string>({
  tabs,
  active,
  routeOf,
  label,
}: {
  tabs: readonly { id: T; label: ReactNode }[];
  active: T;
  routeOf: (id: T) => Route;
  label: string;
}) {
  const nav = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = nav.current;
    const bar = indicator.current;
    if (!node || !bar) return;
    const update = () => {
      const selected = node.querySelector<HTMLElement>("[aria-current='page']");
      if (!selected) return;
      bar.style.width = `${selected.offsetWidth}px`;
      bar.style.transform = `translateX(${selected.offsetLeft}px)`;
      bar.style.opacity = "1";
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    node.querySelectorAll(".tab").forEach((tab) => observer.observe(tab));
    return () => observer.disconnect();
  }, [active]);
  return (
    <div className="tab-bar">
      <nav className="tabs" aria-label={label} ref={nav}>
        {tabs.map((tab) => (
          <a
            key={tab.id}
            className={`tab${tab.id === active ? " tab--active" : ""}`}
            href={hrefOf(routeOf(tab.id))}
            aria-current={tab.id === active ? "page" : undefined}
          >
            {tab.label}
          </a>
        ))}
        <span ref={indicator} className="tab-indicator" aria-hidden="true" />
      </nav>
    </div>
  );
}
