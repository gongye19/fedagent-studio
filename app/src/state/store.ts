// 页面状态：维度选择、数据接入（勾选平台上已有的参与方 + 我方节点或我方上传的文件）、执行预设和当前 Run。
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
import { scenarioOf, type EnhancementId, type ScenarioId } from "../domain/taxonomy";

export type Upload = {
  id: string;
  name: string;
  size: number;
  status: "checking" | "passed" | "failed";
  check: UploadCheck | null;
};

/** 我方节点（节点类场景）：启动后连接平台，在线后参与运行。 */
export type OwnNode = "none" | "connecting" | "online";

export type State = {
  selection: Selection;
  /** 勾选的平台已有参与方（已连接的节点或已提交的文件）。 */
  datasetIds: string[];
  /** 我方上传的文件（文件类场景），Agent 检查通过后才参与运行。 */
  uploads: Upload[];
  ownNode: OwnNode;
  preset: ExecutionPreset;
  run: Run | null;
};

export const initialState: State = {
  selection: EMPTY_SELECTION,
  datasetIds: [],
  uploads: [],
  ownNode: "none",
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
  | { type: "connectNode" }
  | { type: "nodeOnline" }
  | { type: "disconnectNode" }
  | { type: "setPreset"; preset: ExecutionPreset }
  | { type: "startRun"; id: string; createdAt: string }
  | { type: "stageStart"; stage: StageId }
  | { type: "stageFinish"; stage: StageId; result: StageResult }
  | { type: "stageFail"; stage: StageId; error: string }
  | { type: "publish"; visibility: Visibility }
  | { type: "reset" };

const catalogKey = (selection: Selection) => matchedDatasets(selection).map((entry) => entry.id).join(",");

const contractOf = (selection: Selection) => (selection.scenario ? dataContract({ ...selection, scenario: selection.scenario }) : null);

const usesNodes = (selection: Selection) => scenarioOf(selection.scenario)?.input.kind === "nodes";

/**
 * 选择变化后：匹配到的参与方变了就换成新的默认勾选；
 * 数据要求变了（场景或子项变化），清空已上传的文件并断开我方节点。
 */
function withSelection(state: State, selection: Selection): State {
  const sameCatalog = catalogKey(state.selection) === catalogKey(selection);
  const sameContract = contractOf(state.selection) === contractOf(selection);
  return {
    ...state,
    selection,
    datasetIds: sameCatalog ? state.datasetIds : defaultDatasetIds(selection),
    uploads: sameContract ? state.uploads : [],
    ownNode: sameContract ? state.ownNode : "none",
  };
}

/** 本次运行的参与方：勾选的平台已有参与方 + 在线的我方节点 + 检查通过的我方上传。 */
export function runParticipants(state: State): Participant[] {
  if (state.run) return state.run.participants;
  const datasets = matchedDatasets(state.selection).filter((entry) => state.datasetIds.includes(entry.id));
  const contract = contractOf(state.selection);
  const node: Participant[] = state.ownNode === "online" && usesNodes(state.selection)
    ? [{
      id: "own-node",
      name: "我方节点",
      role: state.selection.scenario === "vertical-training" ? "特征方" : "参与方节点",
      provides: contract?.title ?? "本地数据",
      detail: "在线 · 数据留在本地",
      source: "node",
    }]
    : [];
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
    ...node,
    ...uploads,
  ];
}

export type InputStatus = { count: number; min: number; checking: number; failed: number; ready: boolean };

/** 能否开始：参与方够数，我方节点不在连接中，且所有上传都已检查通过（未通过的需要修改或移除）。 */
export function inputStatus(state: State, plan: FrontendRunPlan | null): InputStatus {
  const count = runParticipants(state).length;
  const checking = state.uploads.filter((upload) => upload.status === "checking").length + (state.ownNode === "connecting" ? 1 : 0);
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
      if (locked || !state.selection.scenario || usesNodes(state.selection)) return state;
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

    case "connectNode":
      return locked || !usesNodes(state.selection) || state.ownNode !== "none" ? state : { ...state, ownNode: "connecting" };

    case "nodeOnline":
      return state.ownNode === "connecting" ? { ...state, ownNode: "online" } : state;

    case "disconnectNode":
      return locked ? state : { ...state, ownNode: "none" };

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
