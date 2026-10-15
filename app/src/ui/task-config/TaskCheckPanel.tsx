import { Panel } from "../console";
import { Icon } from "../icons";
import { InlineError } from "./InlineError";
import type { TaskConfigController } from "./useTaskConfig";

export function TaskCheckPanel({ config }: { config: TaskConfigController }) {
  const { preflight, creating, fieldError } = config;
  return (
    <Panel
      title="配置测试"
      id="task-config-check"
      actions={
        <button
          type="button"
          className="button button--secondary button--compact config-test-trigger"
          data-ready={config.canTest}
          disabled={creating || preflight.running || config.validationPending}
          onClick={config.testConfiguration}
        >
          {preflight.running ? "测试中…" : preflight.report ? "重新测试" : "测试配置"}
        </button>
      }
    >
      <p className="muted">检查数据与接口，并发送少量真实请求，会消耗接口额度。测试通过后可开始任务。</p>
      {preflight.report ? (
        <div className="config-check-results" aria-live="polite">
          {!preflight.matches || preflight.expired ? (
            <p className="muted">
              {preflight.expired ? "测试已超过 15 分钟，请重新测试。" : "配置已更改，请重新测试。"}
            </p>
          ) : (
            <>
              <details className="config-check-details" open={preflight.report.status !== "passed"}>
                <summary>查看 {preflight.report.results.length} 项检查结果</summary>
                {preflight.report.results.map((item, index) => (
                  <div className={`config-check-row config-check-row--${item.status}`} key={index}>
                    <Icon
                      name={item.status === "passed" ? "check" : item.status === "failed" ? "alert" : "minus"}
                    />
                    <div>
                      <strong>{item.resource}</strong>
                      <p>{item.message}</p>
                    </div>
                  </div>
                ))}
              </details>
              {preflight.valid ? (
                <p className="config-check-success">当前配置测试通过，可以开始任务。</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {preflight.error ? (
        <p className="field-error" role="alert">
          {preflight.error}
        </p>
      ) : null}
      <InlineError id="check-error" message={fieldError("check")} />
    </Panel>
  );
}
