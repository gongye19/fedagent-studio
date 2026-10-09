import * as Select from "@radix-ui/react-select";
import { Children, isValidElement, useId, type ComponentProps, type ReactNode } from "react";
import { Icon } from "./icons";

type Option = { value?: string | number; disabled?: boolean; children?: ReactNode };
type Props = Pick<ComponentProps<"button">, "id" | "name" | "disabled" | "className" | "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid"> & {
  value: string | number;
  onValueChange?: (value: string) => void;
  children: ReactNode;
};

/** option 仅声明数据；展开、键盘、焦点恢复及边界避让由 Radix Select 负责。 */
export function SelectField({ value, onValueChange, children, name, className, disabled, ...label }: Props) {
  const empty = useId();
  const options: Option[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement<Option>(child) && child.type === "option") options.push(child.props);
  });
  const placeholder = options.find((option) => String(option.value ?? "") === "" && option.disabled);
  const items = options.filter((option) => option !== placeholder);
  const selected = items.find((option) => String(option.value ?? "") === String(value));
  // Radix 不允许空字符串 Item；“不限”这样的有效空值与未选择占位分别处理。
  const radixValue = selected ? String(selected.value ?? "") || empty : String(value);
  return (
    <Select.Root value={radixValue} disabled={disabled} onValueChange={(next) => {
      const actual = next === empty ? "" : next;
      if (actual !== String(value)) onValueChange?.(actual);
    }}>
      {name ? <input type="hidden" name={name} value={value} disabled={disabled} /> : null}
      <Select.Trigger {...label} type="button" className={`select-trigger${className ? ` ${className}` : ""}`} data-select-name={name}
        title={typeof selected?.children === "string" ? selected.children : undefined}>
        <span className="select-value"><Select.Value placeholder={placeholder?.children ?? "请选择"} /></span>
        <Select.Icon className="select-chevron"><Icon name="chevron" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="select-menu" position="popper" align="start" sideOffset={6} collisionPadding={12}
          onClick={(event) => event.stopPropagation()}>
          <Select.ScrollUpButton className="select-scroll select-scroll--up"><Icon name="chevron" /></Select.ScrollUpButton>
          <Select.Viewport className="select-options">
            {items.map((option) => (
              <Select.Item key={String(option.value ?? "")} value={String(option.value ?? "") || empty} disabled={option.disabled} className="select-option" data-option-value={String(option.value ?? "")}>
                <Select.ItemText>{option.children}</Select.ItemText>
                <Select.ItemIndicator className="select-check"><Icon name="check" /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="select-scroll select-scroll--down"><Icon name="chevron" /></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
