/**
 * 控制台风格的表单组件，参考阿里云、AWS 的"创建实例"页：
 * - Panel：灰底画布上的白色配置区块，标题在上；
 * - FormRow：左边字段名、右边控件，说明写在控件下方；
 * - Choices：一组互斥的选项按钮，选中的按钮蓝框、右下角带角标。
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export function Panel({
  title, extra, actions, children, id, flush = false, className,
}: {
  title?: ReactNode;
  /** 标题右边的一句补充，例如"已选 8 个"。 */
  extra?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
  /** 内容贴边（放表格时用）。 */
  flush?: boolean;
  className?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`panel${className ? ` ${className}` : ""}`} id={id} aria-labelledby={title ? headingId : undefined}>
      {title || actions ? (
        <header className="panel-head">
          {title ? <h2 id={headingId}>{title}</h2> : null}
          {extra ? <span className="panel-extra">{extra}</span> : null}
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className={flush ? "panel-body panel-body--flush" : "panel-body"}>{children}</div>
    </section>
  );
}

export function FormRow({
  label, hint, children, htmlFor, labelId,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  /** 控件是单个输入框或下拉框时，传它的 id，点字段名就能聚焦。 */
  htmlFor?: string;
  labelId?: string;
}) {
  return (
    <div className="form-row">
      {htmlFor
        ? <label className="form-label" htmlFor={htmlFor} id={labelId}>{label}</label>
        : <span className="form-label" id={labelId}>{label}</span>}
      <div className="form-control">
        {children}
        {hint ? <div className="form-hint">{hint}</div> : null}
      </div>
    </div>
  );
}

export type Choice<T> = { value: T; label: ReactNode; disabled?: boolean; badge?: string };

/** 选项按钮组：方向键在可选的选项之间移动，只有当前选项在 Tab 顺序里。 */
export function Choices<T extends string | number>({
  value, options, onChange, labelledBy, label,
}: {
  value: T | null;
  options: readonly Choice<T>[];
  onChange: (value: T) => void;
  labelledBy?: string;
  label?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0);
  const current = options.findIndex((option) => option.value === value);
  const focusable = current >= 0 ? current : enabled[0] ?? 0;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step || !enabled.length) return;
    event.preventDefault();
    const position = Math.max(0, enabled.indexOf(index));
    const next = enabled[(position + step + enabled.length) % enabled.length];
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div className="choices" role="radiogroup" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={String(option.value)}
            ref={(element) => { refs.current[index] = element; }}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={option.disabled}
            tabIndex={index === focusable ? 0 : -1}
            className={`choice${checked ? " choice--checked" : ""}`}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
            {option.badge ? <span className="choice-badge">{option.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
