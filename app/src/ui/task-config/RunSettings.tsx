import { SelectField } from "../SelectField";
import type { Algorithm } from "../../domain/catalog";
import type { Draft, RunMode } from "../../domain/config";
import { Choices, Field, FieldGroup, UnitInput } from "../console";

const MODES: readonly { value: RunMode; label: string }[] = [
  { value: "trial", label: "试跑" },
  { value: "full", label: "正式运行" },
];

export function RunSettings({
  draft,
  update,
  algorithm,
  roundsError,
  sampleBounds,
  sampleError,
}: {
  sampleBounds: { min: number; max: number | null };
  sampleError?: string;
  roundsError?: string;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  algorithm: Algorithm | null;
}) {
  const rounds = algorithm
    ? Array.from(
        { length: algorithm.maxRounds - algorithm.minRounds + 1 },
        (_, index) => algorithm.minRounds + index,
      )
    : [];

  return (
    <div className="form-body">
      <FieldGroup>
        <Field
          label="运行方式"
          labelId="mode-label"
          info="试跑只使用每份数据集的前几条样本，适合先确认流程；正式运行使用所选数据集的全部样本。"
        >
          <Choices
            labelledBy="mode-label"
            value={draft.mode}
            options={MODES}
            onChange={(mode) => update({ mode })}
          />
        </Field>
        <Field
          label="试跑样本数"
          htmlFor="trial-cap"
          error={sampleError}
          info={`每份数据集使用的样本数，仅影响试跑。至少 ${sampleBounds.min} 条${sampleBounds.max === null ? "，选择数据后确定上限" : `，最多 ${sampleBounds.max} 条` }。`}
        >
          <UnitInput
            id="trial-cap"
            unit="条 / 数据集"
            name="trial-cap"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            min={sampleBounds.min}
            max={sampleBounds.max ?? undefined}
            value={draft.mode === "trial" ? draft.trialCap : ""}
            disabled={draft.mode !== "trial"}
            placeholder={draft.mode !== "trial" ? "全部样本" : sampleBounds.max === null ? "填写样本数" : `${sampleBounds.min}–${sampleBounds.max}`}
            aria-invalid={Boolean(sampleError)}
            aria-describedby={sampleError ? "trial-cap-error" : undefined}
            onChange={(event) => {
              const value = event.target.value;
              if (/^\d*$/.test(value) && (value === "" || Number.isSafeInteger(Number(value))))
                update({ trialCap: value === "" ? "" : Number(value) });
            }}
            onBlur={() => {
              if (draft.trialCap === "" || sampleBounds.max !== null && sampleBounds.max < sampleBounds.min) return;
              const value = Math.max(sampleBounds.min, Math.min(draft.trialCap, sampleBounds.max ?? Infinity));
              if (value !== draft.trialCap) update({ trialCap: value });
            }}
          />
        </Field>
        {algorithm?.minRounds !== algorithm?.maxRounds || !algorithm ? <Field
          label="轮次"
          error={roundsError}
          htmlFor={algorithm ? undefined : "rounds-pending"}
          labelId="rounds-label"
          wide
          info={
            algorithm
              ? `第 1 轮各方单独作答，作为本地基线；之后每轮都带上上一轮的${algorithm.output.name}再作答。`
              : undefined
          }
        >
          {algorithm ? (
            <Choices
              error={roundsError}
              name="rounds"
              labelledBy="rounds-label"
              value={draft.rounds}
              options={rounds.map((value) => ({ value, label: `${value} 轮` }))}
              onChange={(value) => update({ rounds: value })}
            />
          ) : (
            <SelectField id="rounds-pending" disabled value="">
              <option value="">请先选择算法</option>
            </SelectField>
          )}
        </Field> : null}
      </FieldGroup>
    </div>
  );
}
