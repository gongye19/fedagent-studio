import { clampInt } from "../../domain/validate";
import { SelectField } from "../SelectField";
import {
  paramValue,
  type ParamDef,
  type ParamValue,
  type Params,
} from "../../domain/catalog";
import { Field, UnitInput } from "../console";

/** 按注册表里的参数定义生成一个字段：下拉或数字输入；解释来自注册表，通过 ⓘ 浮层查看。 */
export function ParamField({
  def,
  params,
  onChange,
}: {
  def: ParamDef;
  params: Params;
  onChange: (value: ParamValue) => void;
}) {
  const id = `param-${def.key}`;
  const value = paramValue(def, params);
  if (def.kind === "number") {
    const current = typeof value === "number" ? value : def.default;
    return (
      <Field label={def.label} htmlFor={id} info={def.help}>
        <UnitInput
          id={id}
          unit={def.unit}
          name={def.key}
          type="number"
          inputMode="numeric"
          autoComplete="off"
          min={def.min}
          max={def.max}
          value={current}
          onChange={(event) =>
            onChange(clampInt(event.target.value, def.min, def.max, current))
          }
        />
      </Field>
    );
  }
  if (def.kind === "select-number") {
    return (
      <Field label={def.label} htmlFor={id} info={def.help}>
        <SelectField
          id={id}
          name={def.key}
          value={value ?? ""}
          onValueChange={(value) => onChange(value ? Number(value) : null)}
        >
          {def.options.map((option) => (
            <option key={String(option.value)} value={option.value ?? ""}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </Field>
    );
  }
  return (
    <Field label={def.label} htmlFor={id} info={def.help}>
      <SelectField
        id={id}
        name={def.key}
        value={String(value ?? def.default)}
        onValueChange={(value) => onChange(value)}
      >
        {def.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectField>
    </Field>
  );
}
