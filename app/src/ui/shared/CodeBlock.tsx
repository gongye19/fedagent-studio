import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../icons";

/**
 * 代码块。复制按钮在代码上方，不压住代码；展示的是节选时，用 copyText 复制完整内容。
 * 还没上线的命令（规划中的 API、未发布的客户端）传 copyable={false}，只给人看，不让复制。
 */
export function CodeBlock({
  code,
  copyText,
  copyLabel = "复制",
  title,
  actions,
  wrap = false,
  copyable = true,
  scrollable = false,
}: {
  code: string;
  copyText?: string;
  copyLabel?: string;
  title?: string;
  actions?: ReactNode;
  wrap?: boolean;
  copyable?: boolean;
  scrollable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    const text = copyText ?? code;
    setCopyError(false);
    try {
      if (window.isSecureContext && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        // Tailscale 的 HTTP 地址没有 Clipboard API，仍允许通过用户点击复制。
        const active = document.activeElement as HTMLElement | null;
        const input = document.createElement("textarea");
        input.value = text;
        input.style.cssText = "position:fixed;left:-9999px;top:0";
        input.setAttribute("aria-hidden", "true");
        document.body.append(input);
        try {
          input.select();
          if (!document.execCommand("copy")) throw new Error("copy failed");
        } finally {
          input.remove();
          active?.focus({ preventScroll: true });
        }
      }
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <div className="code">
      {copyable || title || actions ? (
        <div className="code-bar">
          {title ? <strong className="code-title">{title}</strong> : null}
          <div className="code-actions">
            {actions}
            {copyable ? (
              <button
                type="button"
                className="button button--secondary button--compact"
                aria-label={title ? `${copied ? "已复制" : copyLabel}：${title}` : undefined}
                onClick={copy}
              >
                {copied ? (
                  <>
                    <Icon name="check" />
                    已复制
                  </>
                ) : (
                  <>
                    <Icon name="copy" />
                    {copyLabel}
                  </>
                )}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <pre className={`code-block${wrap ? " code-block--wrap" : ""}${scrollable ? " code-block--scrollable" : ""}`}
        translate="no" tabIndex={scrollable ? 0 : undefined} aria-label={scrollable ? title : undefined}>
        {code}
      </pre>
      {copyError ? (
        <p className="field-error" role="status">
          浏览器未允许复制，请选中代码手动复制。
        </p>
      ) : null}
    </div>
  );
}
