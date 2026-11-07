import { Panel } from "../console";
import { CheckRows, CheckStatus } from "../CheckStatus";
import { InfoTip } from "../InfoTip";
import { InlineError } from "./InlineError";
import type { TaskConfigController } from "./useTaskConfig";

export function TaskCheckPanel({ config }: { config: TaskConfigController }) {
  const { preflight, creating, fieldError } = config;
  return (
    <Panel
      title={<>连接检查<InfoTip label="连接检查">资源在接入时完成验证；这里只检查当前可用性，不调用模型或运行 Agent。</InfoTip></>}
      id="task-config-check"
      className="check-panel"
      actions={
        <button
          type="button"
          className="button button--secondary button--compact config-test-trigger"
          data-ready={config.canTest}
          aria-label={preflight.running ? "正在检查连接" : preflight.valid ? "重新检查" : "检查连接"}
          disabled={config.scenarioPlanned || creating || preflight.running || config.validationPending}
          onClick={config.testConfiguration}
        >
          {preflight.running ? <><CheckStatus status="running" />检查中</> : preflight.valid ? <><CheckStatus status="passed" />重新检查</> : "检查连接"}
        </button>
      }
    >
      {preflight.report ? (
        <div className="config-check-results" aria-live="polite">
          {!preflight.matches || preflight.expired ? (
            <p className="muted">
              {preflight.expired ? "请重新检查连接" : "配置已更改，请重新检查"}
            </p>
          ) : (
            <CheckRows items={preflight.report.results} />
          )}
        </div>
      ) : null}
      {!preflight.report ? <CheckRows items={[{ resource: "所选资源", status: preflight.running ? "running" : "pending" }]} /> : null}
      {preflight.error ? (
        <p className="field-error" role="alert">
          {preflight.error}
        </p>
      ) : null}
      <InlineError id="check-error" message={preflight.running || preflight.error || (preflight.matches && preflight.report?.status === "failed") ? undefined : fieldError("check")} />
    </Panel>
  );
}
