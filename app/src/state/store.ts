// 页面状态：维度选择、数据接入（勾选已登记的联邦数据 + 上传待检查的数据）、执行预设和当前 Run。
// Run 开始后冻结计划和参与方；此后配置类动作一律忽略，修改配置必须新建 Run。

import { defaultDatasetIds, matchedDatasets, type Participant } from "../domain/demo";
import { dataContract, type UploadCheck } from "../domain/inputs";
import { buildRunPlan, type FrontendRunPlan } from "../domain/plan";
import {
  EMPTY_SELECTION,
  applyTemplate,
  toggle,
  toggleEnhancement,
  type LayerId,
  type Selection,
} from "../domain/selection";
import { artifactFor } from "../domain/simulator";
import {
  createRun,
  failStage,
  finishStage,
  publishRun,
  startStage,
  type ExecutionPreset,
  type Run,
  type StageId,
  type StageResult,
  type Visibility,
} from "../domain/run";
import type { EnhancementId, ScenarioId } from "../domain/taxonomy";

export type Upload = {
  id: string;
  name: string;
  size: number;
  status: "checking" | "passed" | "failed";
  check: UploadCheck | null;
};

export type State = {
  selection: Selection;
  /** 勾选的已登记联邦数据。 */
  datasetIds: string[];
  /** 用户上传的数据，Agent 检查通过后才参与运行。 */
  uploads: Upload[];
  preset: ExecutionPreset;
  run: Run | null;
};

export const initialState: State = {
  selection: EMPTY_SELECTION,
  datasetIds: [],
  uploads: [],
  preset: "quick",
  run: null,
};

export type Action =
  | { type: "toggle"; layer: LayerId; value: string }
  | { type: "toggleEnhancement"; id: EnhancementId }
  | { type: "clearScenario" }
  | { type: "applyTemplate"; scenario: ScenarioId }
  | { type: "toggleDataset"; id: string }
  | { type: "addUploads"; files: { id: string; name: string; size: number }[] }
  | { type: "uploadChecked"; id: string; check: UploadCheck }
  | { type: "removeUpload"; id: string }
  | { type: "setPreset"; preset: ExecutionPreset }
  | { type: "startRun"; id: string; createdAt: string }
  | { type: "stageStart"; stage: StageId }
  | { type: "stageFinish"; stage: StageId; result: StageResult }
  | { type: "stageFail"; stage: StageId; error: string }
  | { type: "publish"; visibility: Visibility }
  | { type: "reset" };

const catalogKey = (selection: Selection) => matchedDatasets(selection).map((entry) => entry.id).join(",");

/**
 * 选择变化后：匹配到的数据变了就换成新的默认勾选；
 * 场景或各方投入变了（数据契约随之变化），清空已上传的数据。
 */
function withSelection(state: State, selection: Selection): State {
  const sameCatalog = catalogKey(state.selection) === catalogKey(selection);
  const sameContract = state.selection.scenario === selection.scenario && state.selection.contribution === selection.contribution;
  return {
    ...state,
    selection,
    datasetIds: sameCatalog ? state.datasetIds : defaultDatasetIds(selection),
    uploads: sameContract ? state.uploads : [],
  };
}

/** 本次运行的参与方：勾选的已登记数据 + 检查通过的上传数据。 */
export function runParticipants(state: State): Participant[] {
  if (state.run) return state.run.participants;
  const datasets = matchedDatasets(state.selection).filter((entry) => state.datasetIds.includes(entry.id));
  const contract = state.selection.scenario ? dataContract(state.selection.scenario, state.selection.contribution) : null;
  const uploads = state.uploads
    .filter((upload) => upload.status === "passed")
    .map((upload): Participant => ({
      id: upload.id,
      name: upload.name,
      role: "我方上传",
      provides: contract?.title ?? "上传数据",
      detail: upload.check?.records !== null && upload.check?.records !== undefined ? `${upload.check.records} 条 · Agent 检查通过` : "Agent 检查通过",
      source: "upload",
    }));
  return [
    ...datasets.map(({ id, name, role, provides, detail, source }): Participant => ({ id, name, role, provides, detail, source })),
    ...uploads,
  ];
}

export type InputStatus = { count: number; min: number; checking: number; failed: number; ready: boolean };

/** 能否开始：参与数据够数，且所有上传都已检查通过（未通过的需要修改或移除）。 */
export function inputStatus(state: State, plan: FrontendRunPlan | null): InputStatus {
  const count = runParticipants(state).length;
  const checking = state.uploads.filter((upload) => upload.status === "checking").length;
  const failed = state.uploads.filter((upload) => upload.status === "failed").length;
  const min = plan?.minParticipants ?? 0;
  return { count, min, checking, failed, ready: Boolean(plan) && count >= min && checking === 0 && failed === 0 };
}

export function reducer(state: State, action: Action): State {
  const locked = Boolean(state.run);

  switch (action.type) {
    case "toggle":
      return locked ? state : withSelection(state, toggle(state.selection, action.layer, action.value));

    case "toggleEnhancement":
      return locked ? state : { ...state, selection: toggleEnhancement(state.selection, action.id) };

    case "clearScenario":
      // 取消场景：维度 1 及其下游全部清空，重新开始选择。
      return locked ? state : withSelection(state, EMPTY_SELECTION);

    case "applyTemplate":
      return locked ? state : withSelection(state, applyTemplate(action.scenario));

    case "toggleDataset": {
      if (locked || !matchedDatasets(state.selection).some((entry) => entry.id === action.id)) return state;
      const has = state.datasetIds.includes(action.id);
      return { ...state, datasetIds: has ? state.datasetIds.filter((id) => id !== action.id) : [...state.datasetIds, action.id] };
    }

    case "addUploads": {
      if (locked || !state.selection.scenario) return state;
      const fresh = action.files
        .filter((file) => !state.uploads.some((upload) => upload.id === file.id))
        .map((file): Upload => ({ ...file, status: "checking", check: null }));
      return { ...state, uploads: [...state.uploads, ...fresh] };
    }

    case "uploadChecked":
      return {
        ...state,
        uploads: state.uploads.map((upload) => (
          upload.id === action.id ? { ...upload, status: action.check.passed ? "passed" : "failed", check: action.check } : upload
        )),
      };

    case "removeUpload":
      return locked ? state : { ...state, uploads: state.uploads.filter((upload) => upload.id !== action.id) };

    case "setPreset":
      return locked ? state : { ...state, preset: action.preset };

    case "startRun": {
      if (locked) return state;
      const plan = buildRunPlan(state.selection);
      if (!plan || !inputStatus(state, plan).ready) return state;
      return { ...state, run: createRun(action.id, plan, runParticipants(state), state.preset, action.createdAt) };
    }

    case "stageStart":
      return state.run ? { ...state, run: startStage(state.run, action.stage) } : state;

    case "stageFinish":
      return state.run ? { ...state, run: finishStage(state.run, action.stage, action.result) } : state;

    case "stageFail":
      return state.run ? { ...state, run: failStage(state.run, action.stage, action.error) } : state;

    case "publish": {
      if (!state.run) return state;
      const artifact = artifactFor(state.run.plan, state.run.participants, state.run.id, action.visibility);
      return { ...state, run: publishRun(state.run, artifact) };
    }

    case "reset":
      return initialState;

    default:
      return state;
  }
}
