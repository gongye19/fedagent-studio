import type { ReactNode } from "react";
import { Icon } from "./icons";

/**
 * 可点击的选项卡片：名称、说明和要点都在卡片里，整张卡片就是点击区域。
 * 单选选中时是蓝框加勾，多选选中时是浅蓝边加勾；不可选的卡片置灰并显示原因标签。
 */
export function OptionCard({
  type, name, checked, disabled = false, onChange, title, aside, children, foot, compact = false,
}: {
  type: "radio" | "checkbox";
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: ReactNode;
  /** 标题右侧：不可选的原因等；默认显示选中标记。 */
  aside?: ReactNode;
  children?: ReactNode;
  foot?: ReactNode;
  compact?: boolean;
}) {
  return (
    <label className={`option-card option-card--${type === "radio" ? "single" : "multi"}${compact ? " option-card--compact" : ""}${checked ? " option-card--checked" : ""}${disabled ? " option-card--disabled" : ""}`}>
      <input className="option-input" type={type} name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="option-head">
        <span className="option-title">{title}</span>
        {aside ?? <span className={`option-mark option-mark--${type}`} aria-hidden="true">{checked ? <Icon name="check" /> : null}</span>}
      </span>
      {children ? <span className="option-desc">{children}</span> : null}
      {foot ? <span className="option-foot">{foot}</span> : null}
    </label>
  );
}
