/**
 * 控制台风格的组件，版式参考 AWS 控制台（Cloudscape）：
 * - Panel：灰底画布上的白色容器，标题在上；
 * - Field：字段名在上、控件在下。字段名一行写完，可以不填的字段在后面写"（可选）"；
 *   控件下方不放说明文字，只在填错时显示一行错误；
 * - FieldGroup：两栏网格，控件撑满所在的栏，左右边缘对齐；选项按钮组、表格、长文本占满一行；
 *   面板不够宽时自动变成一栏；
 * - UnitInput：数值的单位放在输入框右侧；
 * - Choices：一组互斥的选项按钮，选中的按钮蓝框、右下角带角标。
 */
import { useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./icons";

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

/** 一组字段：可选的小标题 + 两栏网格。面板里有多组时，组与组之间用分隔线隔开。 */
export function FieldGroup({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="field-group">
      {title ? <h3 className="field-group-title">{title}</h3> : null}
      <div className="field-grid">{children}</div>
    </div>
  );
}

export function Field({
  label, optional = false, error, wide = false, htmlFor, labelId, children,
}: {
  label: ReactNode;
  /** 可以不填的字段，字段名后写"（可选）"；必填的不标。 */
  optional?: boolean;
  /** 填错时的一句话，显示在控件下方；控件要带 aria-invalid，并用 aria-describedby 指向 `${htmlFor}-error`。 */
  error?: ReactNode;
  /** 占满一行：选项按钮组、表格、长文本。 */
  wide?: boolean;
  /** 控件是单个输入框或下拉框时，传它的 id，点字段名就能聚焦。 */
  htmlFor?: string;
  labelId?: string;
  children: ReactNode;
}) {
  const text = <>{label}{optional ? <span className="field-optional">（可选）</span> : null}</>;
  return (
    <div className={`field${wide ? " field--wide" : ""}`}>
      {htmlFor
        ? <label className="field-label" htmlFor={htmlFor} id={labelId}>{text}</label>
        : <span className="field-label" id={labelId}>{text}</span>}
      {children}
      {error ? <p className="field-error" id={htmlFor ? `${htmlFor}-error` : undefined}><Icon name="alert" />{error}</p> : null}
    </div>
  );
}

/** 带单位的输入框：单位贴在右侧，读屏软件把单位当作输入框的说明读出。 */
export function UnitInput({ id, unit, ...props }: InputHTMLAttributes<HTMLInputElement> & { id: string; unit: string }) {
  const unitId = `${id}-unit`;
  return (
    <div className="unit-input">
      <input {...props} id={id} aria-describedby={[props["aria-describedby"], unitId].filter(Boolean).join(" ")} />
      <span className="unit-input-suffix" id={unitId}>{unit}</span>
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
