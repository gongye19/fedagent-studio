import { useRef, useState } from "react";
import type { ConsultationComparisonCase } from "../../api/consultationComparison";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "../ai-elements/model-selector";
import { Icon } from "../icons";

export function ComparisonCasePicker({ options, selected, disabled, placeholder, onSelect }: {
  options: ConsultationComparisonCase[];
  selected?: ConsultationComparisonCase;
  disabled: boolean;
  placeholder: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const label = selected?.title ?? (options.length ? `选择病例（${options.length} 例）` : placeholder);
  return <ModelSelector open={open && !disabled} onOpenChange={setOpen}>
    <ModelSelectorTrigger asChild>
      <button type="button" id="compare-case" className="select-trigger model-picker-trigger" disabled={disabled} title={label}>
        <ModelSelectorName>{label}</ModelSelectorName>
        <span className="select-chevron"><Icon name="chevron" /></span>
      </button>
    </ModelSelectorTrigger>
    <ModelSelectorContent title="选择留出病例" closeLabel="关闭病例选择" onOpenAutoFocus={(event) => {
      event.preventDefault();
      input.current?.focus();
    }}>
      <ModelSelectorInput ref={input} aria-label="搜索病例" placeholder="搜索病例编号或主诉…" />
      <ModelSelectorList>
        <ModelSelectorEmpty>没有匹配的病例</ModelSelectorEmpty>
        {options.map((item) => <ModelSelectorItem key={item.id} value={item.id}
          keywords={[item.title, item.opening]} onSelect={() => { onSelect(item.id); setOpen(false); }}>
          <ModelSelectorName>{item.title}</ModelSelectorName>
          {selected?.id === item.id && <Icon name="check" />}
        </ModelSelectorItem>)}
      </ModelSelectorList>
    </ModelSelectorContent>
  </ModelSelector>;
}
