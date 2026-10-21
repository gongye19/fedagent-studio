import { SelectField } from "../SelectField";
import type { Algorithm } from "../../domain/catalog";
import type { Draft, RunMode } from "../../domain/config";
import { Choices, Field, FieldGroup, UnitInput } from "../console";
import { clampInt } from "../../domain/validate";

const MODES: readonly { value: RunMode; label: string }[] = [
  { value: "trial", label: "试跑" },
  { value: "full", label: "正式运行" },
];

export function RunSettings({
  draft,
  update,
  algorithm,
  roundsError,
}: {
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
          info="每份数据集使用的样本上限，仅影响试跑。"
        >
          <UnitInput
            id="trial-cap"
            unit="条 / 数据集"
            name="trial-cap"
            type="number"
            inputMode="numeric"
            autoComplete="off"
            min={algorithm?.minSamples ?? 1}
            max={50}
            value={draft.mode === "trial" ? draft.trialCap : ""}
            disabled={draft.mode !== "trial"}
            placeholder="全部样本"
            onChange={(event) =>
              update({
                trialCap: clampInt(
                  event.target.value,
                  algorithm?.minSamples ?? 1,
                  50,
                  draft.trialCap,
                ),
              })
            }
          />
        </Field>
        <Field
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
        </Field>
      </FieldGroup>
    </div>
  );
}
