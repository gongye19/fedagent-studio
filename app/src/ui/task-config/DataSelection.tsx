import { SelectField } from "../SelectField";
import { InfoTip } from "../InfoTip";
import { useEffect, useRef, type Dispatch, type MouseEvent } from "react";
import { type DataSourceChoice, type Draft } from "../../domain/config";
import { DATA_LOCATION_LABELS } from "../../domain/resources";
import { type Action } from "../../state/store";
import { formatNumber } from "../format";

/** 点行里任意位置都能选中；点到输入框、下拉框和标签时交给浏览器处理，避免切换两次。 */
function rowToggle(enabled: boolean, toggle: () => void) {
  return (event: MouseEvent<HTMLTableRowElement>) => {
    if (!enabled || (event.target as HTMLElement).closest("input, select, label, a, button")) return;
    toggle();
  };
}

/**
 * 参与方：带复选框的表格，一行一个参与方，表头可以全选。每个参与方出一份数据集，
 * 只展示在线且有匹配、已就绪数据集的参与方，多份可用数据集在行内选择。
 */
export function ParticipantTable({
  draft,
  dispatch,
  candidates,
  error,
}: {
  error?: string;
  draft: Draft;
  dispatch: Dispatch<Action>;
  candidates: readonly DataSourceChoice[];
}) {
  const head = useRef<HTMLInputElement>(null);
  const picks = new Map(draft.participants.map((item) => [item.participantId, item.datasetId]));
  const open = candidates.map(({ participant, datasets }) => ({
    participant,
    ready: datasets,
    picked: datasets.find((dataset) => dataset.id === picks.get(participant.id)),
  }));
  const chosen = open.filter((row) => row.picked).length;
  const all = open.length > 0 && chosen === open.length;
  const some = !all && chosen > 0;

  useEffect(() => {
    if (head.current) head.current.indeterminate = some;
  }, [some]);

  function selectAll() {
    const visible = new Set(open.map((row) => row.participant.id));
    dispatch({
      type: "setParticipants",
      participants: [
        ...draft.participants.filter((p) => !visible.has(p.participantId)),
        ...(all
          ? []
          : open.map(({ participant, ready, picked }) => ({
              participantId: participant.id,
              datasetId: (picked ?? ready[0]).id,
            }))),
      ],
    });
  }

  return (
    <div className="table-shell">
      <table className="table table--select" aria-describedby={error ? "participants-error" : undefined}>
        <caption className="visually-hidden">选择任务数据，每个来源一份</caption>
        <thead>
          <tr>
            <th scope="col" className="select-cell">
              <input
                ref={head}
                type="checkbox"
                aria-label="全选"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "participants-error" : undefined}
                checked={all}
                disabled={!open.length}
                onChange={selectAll}
              />
            </th>
            {/* 手机上也要看得到、选得了数据集，收起的是样本数和存放位置 */}
            <th scope="col">数据集</th>
            <th scope="col" className="numeric col-optional">
              样本
            </th>
            <th scope="col" className="col-optional">
              存放位置
            </th>
          </tr>
        </thead>
        <tbody>
          {open.map(({ participant, ready, picked }) => {
            const checked = picked !== undefined;
            const choices = ready;
            const shown = picked ?? choices[0];
            const toggle = () =>
              dispatch({ type: "pickDataset", participantId: participant.id, datasetId: checked ? null : shown.id });
            const inputId = `pick-${participant.id}`;
            return (
              <tr
                key={participant.id}
                className={`select-row${checked ? " select-row--checked" : ""}`}
                onClick={rowToggle(true, toggle)}
              >
                <td className="select-cell">
                  <input
                    id={inputId}
                    type="checkbox"
                    aria-label={`选择 ${shown.name}`}
                    checked={checked}
                    onChange={toggle}
                  />
                </td>
                <th scope="row">
                  {choices.length > 1 ? (
                    <SelectField
                      className="cell-select"
                      name={`dataset-${participant.id}`}
                      aria-label={`${participant.name} 用的数据集`}
                      value={shown.id}
                      // 选了数据集就是要让这个参与方参加。
                      onValueChange={(value) =>
                        dispatch({ type: "pickDataset", participantId: participant.id, datasetId: value })
                      }
                    >
                      {choices.map((dataset) => (
                        <option key={dataset.id} value={dataset.id}>
                          {dataset.name}
                        </option>
                      ))}
                    </SelectField>
                  ) : (
                    <label htmlFor={inputId}>{shown.name}</label>
                  )}
                  <InfoTip label={`${shown.name} 的来源`}>
                    {participant.name} · {DATA_LOCATION_LABELS[participant.hosting]}
                  </InfoTip>
                </th>
                <td className="numeric col-optional">{formatNumber(shown.count)}</td>
                <td className="col-optional">{DATA_LOCATION_LABELS[participant.hosting]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
