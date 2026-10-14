import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api/client";
import { clearFlash, useFlash } from "./state/flash";
import { loadDraft, saveDraft } from "./state/draft";
import { hrefOf, pageKeyOf, useRoute } from "./state/route";
import { keys, useServerData } from "./state/server";
import { reducer, withoutMissing, type Action, type State } from "./state/store";
import { installRegistry } from "./domain/catalog";
import { Toast } from "./ui/common";
import { useContentMotion } from "./ui/hooks";
import { Sidebar } from "./shell/Sidebar";
import { PageRouter } from "./shell/PageRouter";
import { Loading, Unavailable, TokenGate } from "./shell/AppStatus";

export default function App() {
  const route = useRoute();
  const pageKey = pageKeyOf(route);
  const pageMotion = useContentMotion(pageKey);
  const firstPage = useRef(true);
  const flash = useFlash(route);
  // 注册表（后端安装的场景、任务类型、算法）和数据同时取，都到了才渲染页面；需要访问令牌时先输入令牌。
  const registry = useQuery({
    queryKey: keys.registry,
    queryFn: async () => {
      const data = await api.registry();
      installRegistry(data);
      return data;
    },
    staleTime: Infinity,
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
  });
  // 不等注册表：数据不依赖它，同时发出能省一次往返（经 Tailscale 中继时每次约 0.3 秒）；没有令牌时不再轮询
  const unauthorized = registry.error instanceof ApiError && registry.error.status === 401;
  const server = useServerData(!unauthorized);
  const [draft, setDraft] = useState(loadDraft);
  const datasets = useRef(server.data.datasets);
  useEffect(() => {
    datasets.current = server.data.datasets;
  });
  const dispatch = useCallback(
    (action: Action) => setDraft((previous) => reducer(previous, action, datasets.current)),
    [],
  );
  useEffect(() => saveDraft(draft), [draft]);

  useEffect(() => {
    // 换页后焦点移到主内容，读屏软件从新页面开头读起；同一页里展开行、切换标签不算换页。
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [pageKey]);

  useEffect(() => {
    // 提示条只属于它显示的那一页，换到别的页就收起。
    if (!flash) clearFlash();
  }, [pageKey, flash]);

  const error = registry.error ?? server.error;
  if (error instanceof ApiError && error.status === 401) return <TokenGate />;
  const state: State | null =
    registry.isSuccess && server.ready ? { ...server.data, draft: withoutMissing(draft, server.data.datasets) } : null;
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        跳到主要内容
      </a>
      <Sidebar route={route} state={state} />
      <main className="main" id="main" tabIndex={-1}>
        <div className="page" ref={pageMotion}>
          {flash ? (
            <Toast
              key={flash.id}
              action={
                flash.link ? (
                  <a className="text-link" href={hrefOf(flash.link.route)}>
                    {flash.link.label}
                  </a>
                ) : undefined
              }
              onDismiss={clearFlash}
            >
              {flash.text}
            </Toast>
          ) : null}
          {state ? (
            <PageRouter state={state} dispatch={dispatch} route={route} />
          ) : error ? (
            <Unavailable error={error} />
          ) : (
            <Loading />
          )}
        </div>
      </main>
    </div>
  );
}
