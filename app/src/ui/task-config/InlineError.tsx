import { Icon } from "../icons";

/** 表格错误留在对应面板内，供键盘和读屏定位。 */
export function InlineError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p className="field-error task-section-error" id={id} role="alert">
      <Icon name="alert" />
      {message}
    </p>
  ) : null;
}
