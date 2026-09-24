import { useState, type ReactNode } from "react";
import {
  PARTITIONS,
  PROTECTIONS,
  TOPOLOGIES,
  WORKLOADS,
  protectionOf,
  workloadOf,
  type SelectOption,
} from "../domain/configuration";
import type { Action, State } from "../state/store";

type Props = { state: State; dispatch: (action: Action) => void };
type PickerId = string;
type DisplayOption = SelectOption & { disabled?: boolean };

export default function RunBuilder({ state, dispatch }: Props) {
  const locked = Boolean(state.run);
  const [openPicker, setOpenPicker] = useState<PickerId | null>(null);
  const configuration = state.configuration;
  const workload = workloadOf(configuration.workloadId);
  const protection = protectionOf(configuration.protectionId);

  function togglePicker(id: PickerId) {
    setOpenPicker((current) => current === id ? null : id);
  }

  const partitionOptions: DisplayOption[] = PARTITIONS.map((option) => ({
    ...option,
    disabled: !workload.partitionIds.includes(option.id),
  }));
  const topologyOptions: DisplayOption[] = TOPOLOGIES.map((option) => ({
    ...option,
    disabled: !workload.topologyIds.includes(option.id),
  }));

  return (
    <div className="configuration-form">
      <ConfigModule title="联邦任务">
        <ChoiceField
          pickerId="workload"
          label="任务"
          value={configuration.workloadId}
          options={WORKLOADS}
          open={openPicker === "workload"}
          locked={locked}
          onToggle={() => togglePicker("workload")}
          onSelect={(id) => {
            dispatch({ type: "setWorkload", id });
            setOpenPicker(null);
          }}
        />
      </ConfigModule>

      <ConfigModule title="数据关系">
        <ChoiceField
          pickerId="partition"
          label="数据如何分布"
          value={configuration.partitionId}
          options={partitionOptions}
          open={openPicker === "partition"}
          locked={locked}
          onToggle={() => togglePicker("partition")}
          onSelect={(id) => {
            dispatch({ type: "setPartition", id });
            setOpenPicker(null);
          }}
        />
      </ConfigModule>

      <ConfigModule title="参与方">
        <ChoiceField
          pickerId="topology"
          label="节点形态"
          value={configuration.topologyId}
          options={topologyOptions}
          open={openPicker === "topology"}
          locked={locked}
          onToggle={() => togglePicker("topology")}
          onSelect={(id) => {
            dispatch({ type: "setTopology", id });
            setOpenPicker(null);
          }}
        />
      </ConfigModule>

      <ConfigModule title="协作策略">
        <ChoiceField
          pickerId="strategy"
          label="算法"
          value={configuration.strategyId}
          options={workload.strategies}
          open={openPicker === "strategy"}
          locked={locked}
          onToggle={() => togglePicker("strategy")}
          onSelect={(id) => {
            dispatch({ type: "setStrategy", id });
            setOpenPicker(null);
          }}
        />
      </ConfigModule>

      <ConfigModule title="隐私保护">
        <ChoiceField
          pickerId="protection"
          label="保护目标"
          value={configuration.protectionId}
          options={PROTECTIONS}
          open={openPicker === "protection"}
          locked={locked}
          onToggle={() => togglePicker("protection")}
          onSelect={(id) => {
            dispatch({ type: "setProtection", id });
            setOpenPicker(null);
          }}
        />
        <div className="mechanism-list" aria-label="启用的保护机制">
          {protection.mechanisms.map((mechanism) => <span key={mechanism}>{mechanism}</span>)}
        </div>
      </ConfigModule>

      <ConfigModule title="任务专属配置" wide>
        <div className="workload-settings-grid">
          {workload.settings.map((setting) => {
            const pickerId = `setting-${setting.id}`;
            return (
              <ChoiceField
                key={setting.id}
                pickerId={pickerId}
                label={setting.label}
                value={configuration.settings[setting.id] ?? null}
                options={setting.options}
                open={openPicker === pickerId}
                locked={locked}
                onToggle={() => togglePicker(pickerId)}
                onSelect={(value) => {
                  dispatch({ type: "setWorkloadSetting", key: setting.id, value });
                  setOpenPicker(null);
                }}
              />
            );
          })}
        </div>

        <dl className="resolved-plan" aria-label="系统生成的运行方案">
          <div><dt>Runner</dt><dd>{workload.runner}</dd></div>
          <div><dt>Artifact</dt><dd>{workload.artifact}</dd></div>
          <div><dt>Evaluation</dt><dd>{workload.evaluation}</dd></div>
          <div><dt>Output</dt><dd>{workload.output}</dd></div>
        </dl>
      </ConfigModule>
    </div>
  );
}

function ConfigModule({
  title, wide = false, children,
}: {
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`config-module${wide ? " config-module--wide" : ""}`}>
      <header className="config-module-head"><h3>{title}</h3></header>
      <div className="config-module-body">{children}</div>
    </section>
  );
}

type ChoiceFieldProps = {
  pickerId: PickerId;
  label: string;
  value: string | null;
  options: readonly DisplayOption[];
  open: boolean;
  locked: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
};

function ChoiceField({
  pickerId, label, value, options, open, locked, onToggle, onSelect,
}: ChoiceFieldProps) {
  const selected = options.find((option) => option.id === value);
  const optionsId = `${pickerId}-options`;

  return (
    <div className="choice-field">
      <button
        type="button"
        className="choice-trigger"
        aria-controls={optionsId}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={locked}
        onClick={onToggle}
      >
        <span>{label}</span>
        <strong>{selected?.label ?? "请选择"}</strong>
        <span className="choice-chevron" aria-hidden="true">⌄</span>
      </button>

      {open && !locked ? (
        <div className="choice-options" id={optionsId} role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              type="button"
              className="choice-option"
              role="option"
              aria-selected={value === option.id}
              aria-disabled={option.disabled || undefined}
              disabled={option.disabled}
              key={option.id}
              onClick={() => onSelect(option.id)}
            >
              <span className="choice-check" aria-hidden="true">{value === option.id ? "✓" : ""}</span>
              <strong>{option.label}</strong>
              {option.disabled ? <span className="choice-availability">不适用</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
