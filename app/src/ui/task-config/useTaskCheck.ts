import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { checkState } from "./check-state";
import { api, type TaskConfigIn } from "../../api/client";

const KEY = "fedagent-studio:config-check";
type Saved = { id: string; config: string };
function saved(): Saved | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    return value &&
      typeof value === "object" &&
      "id" in value &&
      "config" in value &&
      typeof value.id === "string" &&
      typeof value.config === "string"
      ? { id: value.id, config: value.config }
      : null;
  } catch {
    return null;
  }
}

/** 测试只由用户触发；刷新继续读取原报告，改配置不会自动发起新检查。 */
export function useTaskCheck(
  request: TaskConfigIn | null,
  ready: boolean,
  resourceVersion: string,
) {
  const signature = JSON.stringify(
    request
      ? { config: { ...request, name: "" }, resources: resourceVersion }
      : null,
  );
  const client = useQueryClient();
  const [current, setCurrent] = useState<Saved | null>(saved);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ signature: string; message: string } | null>(null);
  const [now, setNow] = useState(Date.now);
  const report = useQuery({
    queryKey: ["task-check", current?.id],
    queryFn: () => api.taskCheck(current!.id),
    enabled: Boolean(current),
    retry: 1,
    refetchInterval: (query) =>
      query.state.data?.status === "queued" ||
      query.state.data?.status === "running"
        ? 1000
        : false,
  });
  const matches = current?.config === signature;
  const view = checkState(submitting, matches, report.isPending, report.data);
  const running = view.running;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const expired = Boolean(
    report.data && now - Date.parse(report.data.createdAt) >= 15 * 60_000,
  );
  const valid = Boolean(
    matches && !running && !report.isError && !expired && report.data?.status === "passed",
  );
  async function test() {
    if (!request || !ready || running) return;
    setSubmitting(true);
    setError(null);
    try {
      const value = await api.testTask(request);
      client.setQueryData(["task-check", value.id], value);
      const next = { id: value.id, config: signature };
      setCurrent(next);
      try {
        sessionStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* 本次页面仍保留测试 */
      }
    } catch (failure) {
      setError({ signature, message: failure instanceof Error ? failure.message : "连接检查失败，请重试" });
    } finally {
      setSubmitting(false);
      setNow(Date.now());
    }
  }
  return {
    id: valid ? current?.id : undefined,
    valid,
    running: Boolean(running),
    matches,
    expired,
    report: view.report,
    error: submitting ? null : error?.signature === signature ? error.message : matches && !running && report.isError ? "无法读取连接状态，请重试" : null,
    test,
  };
}
