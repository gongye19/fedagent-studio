import type { ReactNode } from "react";
import { Icon } from "./icons";

/**
 * 可点击的选项卡片：名称、说明和要点都在卡片里，整张卡片就是点击区域。全站只有这一种尺寸。
 * 只用于 2–3 个、各有说明的关键单选；选项更多或是次要设置用下拉框，多选一组对象用带复选框的表格。
 * 选中时蓝框加勾；不可选的卡片置灰并在右上角显示原因标签。
 */
export function OptionCard({
  name, checked, disabled = false, onChange, title, aside, children, foot,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: ReactNode;
  /** 标题右侧：不可选的原因等；默认显示选中标记。 */
  aside?: ReactNode;
  children?: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <label className={`option-card${checked ? " option-card--checked" : ""}${disabled ? " option-card--disabled" : ""}`}>
      <input className="option-input" type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="option-head">
        <span className="option-title">{title}</span>
        {aside ?? <span className="option-mark" aria-hidden="true">{checked ? <Icon name="check" /> : null}</span>}
      </span>
      {children ? <span className="option-desc">{children}</span> : null}
      {foot ? <span className="option-foot">{foot}</span> : null}
    </label>
  );
}
