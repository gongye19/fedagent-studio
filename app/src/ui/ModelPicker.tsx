import { useRef, useState } from "react";
import type { Endpoint } from "../domain/resources";
import { endpointOf, modelLabel, parseModelRef } from "../domain/resources";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "./ai-elements/model-selector";
import { Icon } from "./icons";

type Props = {
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly { ref: string; label: string }[];
  endpoints: readonly Endpoint[];
  disabled?: boolean;
  placeholder?: string;
};

/** 统一模型选择：只有一个模型也可展开；选项只来自平台登记，不添加供应商。 */
export function ModelPicker({
  id,
  name,
  value,
  onValueChange,
  options,
  endpoints,
  disabled,
  placeholder,
  "aria-label": ariaLabel,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: Props) {
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const groups = endpoints
    .map((endpoint) => ({
      endpoint,
      options: options.filter(
        (option) => endpointOf(option.ref, endpoints)?.id === endpoint.id,
      ),
    }))
    .filter((group) => group.options.length);
  const label = ariaLabel ?? (id ? undefined : "模型");
  const title =
    placeholder ??
    (options.some((option) => option.ref === value)
      ? modelLabel(value, endpoints)
      : options.length
        ? "请选择模型"
        : "没有可选模型");
  return (
    <ModelSelector open={open && !disabled} onOpenChange={setOpen}>
      {name ? (
        <input type="hidden" name={name} value={value} disabled={disabled} />
      ) : null}
      <ModelSelectorTrigger asChild>
        <button
          type="button"
          id={id}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          aria-label={label}
          disabled={disabled}
          title={title}
          className="select-trigger model-picker-trigger"
          data-model-name={name}
        >
          <ModelSelectorName>{title}</ModelSelectorName>
          <span className="select-chevron">
            <Icon name="chevron" />
          </span>
        </button>
      </ModelSelectorTrigger>
      <ModelSelectorContent
        title="选择模型"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          search.current?.focus();
        }}
      >
        <ModelSelectorInput
          ref={search}
          aria-label="搜索模型或接口"
          placeholder="搜索模型或接口…"
        />
        <ModelSelectorList>
          <ModelSelectorEmpty>没有匹配的模型</ModelSelectorEmpty>
          {groups.map(({ endpoint, options: items }) => (
            <ModelSelectorGroup
              key={endpoint.id}
              heading={`${endpoint.resourceSpace === "public" ? "共享资源" : "我的资源"} · ${endpoint.name}`}
            >
              {items.map((option) => {
                const model =
                  parseModelRef(option.ref)?.model ??
                  endpoint.models[0] ??
                  "待配置";
                const checked = option.ref === value;
                return (
                  <ModelSelectorItem
                    key={option.ref}
                    value={option.ref}
                    keywords={[option.label, endpoint.name, model]}
                    data-model-value={option.ref}
                    onSelect={() => {
                      onValueChange(option.ref);
                      setOpen(false);
                    }}
                  >
                    <ModelSelectorName>{model}</ModelSelectorName>
                    {checked ? <Icon name="check" /> : null}
                  </ModelSelectorItem>
                );
              })}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}
