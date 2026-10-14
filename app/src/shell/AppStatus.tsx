import { useState, type FormEvent } from "react";
import { ApiError, getToken, setToken } from "../api/client";
import { queryClient } from "../state/server";
import { EmptyState, PageHead } from "../ui/common";

export function Loading() {
  return (
    <p className="page-loading" role="status">
      正在读取…
    </p>
  );
}

/** 连不上后端，或者后端返回了错误。 */
export function Unavailable({ error }: { error: Error }) {
  return (
    <>
      <PageHead title="服务暂不可用" />
      <EmptyState
        title={error instanceof ApiError && error.status === 0 ? "连不上后端服务" : "读取数据失败"}
        action={
          <button type="button" className="button button--secondary" onClick={() => queryClient.invalidateQueries()}>
            重试
          </button>
        }
      >
        <p>{error.message}</p>
      </EmptyState>
    </>
  );
}

/** 部署设置了访问令牌：先输入令牌（保存在这个浏览器里）。 */
export function TokenGate() {
  const [value, setValue] = useState("");
  const [failed, setFailed] = useState(Boolean(getToken()));
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    setToken(value.trim());
    setFailed(false);
    void queryClient.resetQueries();
  }
  return (
    <main className="token-gate" id="main">
      <form className="token-gate-card" onSubmit={submit}>
        <h1>FedAgent Studio</h1>
        <label className="field-label" htmlFor="access-token">
          访问令牌
        </label>
        <input
          id="access-token"
          name="access-token"
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        {failed ? (
          <p className="field-error" role="alert">
            令牌不对或已过期，请重新输入
          </p>
        ) : null}
        <button type="submit" className="button button--primary" disabled={!value.trim()}>
          进入
        </button>
      </form>
    </main>
  );
}
