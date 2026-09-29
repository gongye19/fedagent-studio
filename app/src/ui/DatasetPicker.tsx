import { useEffect, useId, useRef, useState } from "react";
import { TASK_TYPES, type TaskType } from "../domain/catalog";
import type { Dataset } from "../domain/resources";
import { checkJsonl, MAX_FILE_BYTES, MAX_PROBLEMS, type JsonlCheck } from "../domain/validate";
import { newId } from "../state/ids";
import { Choices, Field, FieldGroup } from "./console";
import { formatNumber } from "./format";
import { Icon } from "./icons";

const TYPES = Object.keys(TASK_TYPES) as TaskType[];

/** 任务类型：登记数据集时由用户选（决定数据格式和能参加哪些任务），不替用户默认。 */
export function TaskTypeField({ value, onChange }: { value: TaskType | null; onChange: (type: TaskType) => void }) {
  const id = useId();
  return (
    <Field label="任务类型" labelId={id} wide>
      <Choices labelledBy={id} value={value} options={TYPES.map((type) => ({ value: type, label: TASK_TYPES[type].label }))} onChange={onChange} />
    </Field>
  );
}

type FileState = { name: string; size: number; check: JsonlCheck | null; error?: string };

/**
 * 登记一份上传到平台的数据集：先选任务类型，再选文件并在浏览器里检查；
 * 检查通过后只保存描述（样本数、标注数、示例），不保存内容。数据格式按任务类型写在上传框里。
 * 新增参与方页和参与方详情里的上传表单共用它。
 */
export function DatasetPicker({
  heading, taskType, onTaskType, onChange,
}: {
  heading?: string;
  taskType: TaskType | null;
  onTaskType: (type: TaskType) => void;
  onChange: (dataset: Omit<Dataset, "participantId"> | null) => void;
}) {
  // 两处表单可能同时打开，id 不能写死。
  const uid = useId();
  const ids = { file: `${uid}-file`, format: `${uid}-format`, name: `${uid}-name`, description: `${uid}-description` };
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<FileState | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const type = taskType ? TASK_TYPES[taskType] : null;

  function emit(next: FileState | null, nextTitle: string, nextDescription: string, nextType = taskType) {
    const check = next?.check;
    if (!next || !check?.ok || !nextType) {
      onChange(null);
      return;
    }
    onChange({
      id: newId("ds"),
      name: nextTitle.trim() || next.name.replace(/\.jsonl?$/i, ""),
      description: nextDescription.trim(),
      taskType: nextType,
      count: check.count,
      answered: check.answered,
      source: "upload",
      sample: check.sample,
    });
  }

  // 换了任务类型时，已经检查过的文件按新的类型重新登记。
  const emitted = useRef(taskType);
  useEffect(() => {
    if (emitted.current === taskType) return;
    emitted.current = taskType;
    emit(file, title, description, taskType);
  });

  async function pick(selected: File | undefined) {
    if (!selected) return;
    if (selected.size > MAX_FILE_BYTES) {
      const next = { name: selected.name, size: selected.size, check: null, error: "文件超过 20 MB，请拆分后再选择" };
      setFile(next);
      emit(next, title, description);
      return;
    }
    const check = checkJsonl(await selected.text());
    const next = { name: selected.name, size: selected.size, check };
    setFile(next);
    emit(next, title, description);
  }

  function choose() {
    // 同一个文件改好后再次选择时也要触发检查。
    if (input.current) input.current.value = "";
    input.current?.click();
  }

  const failed = file && !file.check?.ok;
  return (
    <FieldGroup title={heading}>
      <TaskTypeField value={taskType} onChange={onTaskType} />
      {type ? (
        <Field label="数据集文件" labelId={ids.file} wide>
          <label className="upload-zone">
            <input ref={input} name="dataset-file" type="file" accept=".jsonl,.json,application/json" aria-labelledby={ids.file} aria-describedby={ids.format} onChange={(event) => pick(event.target.files?.[0])} />
            <Icon name="upload" />
            <strong>{file ? file.name : "选择 JSONL 文件"}</strong>
            <span id={ids.format}>每行一条 <code>{type.format}</code>；{type.unlabeledNote}；不超过 20&nbsp;MB</span>
          </label>
          {file ? (
            <div className={`check-result${failed ? " check-result--failed" : " check-result--ok"}`} aria-live="polite">
              {file.error ? <p><Icon name="x" />{file.error}</p> : null}
              {file.check?.ok ? (
                <p><Icon name="check" />检查通过：{formatNumber(file.check.count)} 条样本，其中 {formatNumber(file.check.answered)} 条有标注。</p>
              ) : null}
              {file.check && !file.check.ok ? (
                <>
                  <p><Icon name="x" />有 {file.check.problemCount} 处问题{file.check.count ? `（另有 ${file.check.count} 条合格）` : ""}{file.check.problemCount > MAX_PROBLEMS ? `，下面只列前 ${MAX_PROBLEMS} 处` : ""}：</p>
                  <ul>
                    {file.check.problems.map((problem) => (
                      <li key={`${problem.line}-${problem.message}`}>{problem.line ? `第 ${problem.line} 行：` : ""}{problem.message}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {failed ? <button type="button" className="button button--secondary button--compact check-retry" onClick={choose}>改好后重新选择文件</button> : null}
            </div>
          ) : null}
        </Field>
      ) : null}
      {type && file?.check?.ok ? (
        <>
          <Field label="数据集名称" optional htmlFor={ids.name}>
            <input id={ids.name} name="dataset-name" autoComplete="off" value={title} placeholder={file.name.replace(/\.jsonl?$/i, "")} maxLength={40} onChange={(event) => { setTitle(event.target.value); emit(file, event.target.value, description); }} />
          </Field>
          <Field label="说明" optional htmlFor={ids.description}>
            <input id={ids.description} name="dataset-description" autoComplete="off" value={description} placeholder="例如：2024 年收集的样本" maxLength={60} onChange={(event) => { setDescription(event.target.value); emit(file, title, event.target.value); }} />
          </Field>
        </>
      ) : null}
    </FieldGroup>
  );
}
