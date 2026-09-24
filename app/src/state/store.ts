// 页面状态：维度选择、参与方接入、执行预设和当前 Run。
// Run 开始后冻结计划和参与方；此后配置类动作一律忽略，修改配置必须新建 Run。

import { defaultParticipants, participantPool, type Participant } from "../domain/demo";
import { buildRunPlan } from "../domain/plan";
import {
  EMPTY_SELECTION,
  applyTemplate,
  choose,
  scenarioFor,
  setParam,
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
import type { ScenarioId } from "../domain/taxonomy";

export type State = {
  selection: Selection;
  participants: Participant[];
  preset: ExecutionPreset;
  run: Run | null;
};

export const initialState: State = {
  selection: EMPTY_SELECTION,
  participants: [],
  preset: "quick",
  run: null,
};

export type Action =
  | { type: "choose"; layer: LayerId; value: string }
  | { type: "applyTemplate"; scenario: ScenarioId }
  | { type: "setParam"; id: string; value: string }
  | { type: "addParticipant" }
  | { type: "removeParticipant"; id: string }
  | { type: "uploadFiles"; files: { name: string; size: number; lastModified: number }[] }
  | { type: "setPreset"; preset: ExecutionPreset }
  | { type: "startRun"; id: string; createdAt: string }
  | { type: "stageStart"; stage: StageId }
  | { type: "stageFinish"; stage: StageId; result: StageResult }
  | { type: "stageFail"; stage: StageId; error: string }
  | { type: "publish"; visibility: Visibility }
  | { type: "reset" };

/** 场景或各方投入变化时，参与方换成新场景的示例；否则保留用户的调整。 */
function withSelection(state: State, selection: Selection): State {
  const before = scenarioFor(state.selection);
  const after = scenarioFor(selection);
  const sameInputs = before?.id === after?.id && state.selection.contribution === selection.contribution;
  return {
    ...state,
    selection,
    participants: sameInputs ? state.participants : defaultParticipants(after?.id, selection.contribution),
  };
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function reducer(state: State, action: Action): State {
  const locked = Boolean(state.run);

  switch (action.type) {
    case "choose":
      return locked ? state : withSelection(state, choose(state.selection, action.layer, action.value));

    case "applyTemplate":
      return locked ? state : withSelection(state, applyTemplate(action.scenario));

    case "setParam":
      return locked ? state : { ...state, selection: setParam(state.selection, action.id, action.value) };

    case "addParticipant": {
      if (locked) return state;
      const scenario = scenarioFor(state.selection);
      const next = participantPool(scenario?.id, state.selection.contribution)
        .find((candidate) => !state.participants.some((participant) => participant.id === candidate.id));
      return next ? { ...state, participants: [...state.participants, next] } : state;
    }

    case "removeParticipant":
      return locked ? state : { ...state, participants: state.participants.filter((participant) => participant.id !== action.id) };

    case "uploadFiles": {
      if (locked) return state;
      const uploaded: Participant[] = action.files.map((file) => ({
        id: `upload-${file.name}-${file.lastModified}`,
        name: file.name,
        role: "上传产物",
        provides: "待解析 manifest",
        detail: `${formatSize(file.size)} · 进入隔离 staging（前端模拟，不保存文件内容）`,
        source: "upload",
      }));
      const fresh = uploaded.filter((file) => !state.participants.some((participant) => participant.id === file.id));
      return { ...state, participants: [...state.participants, ...fresh] };
    }

    case "setPreset":
      return locked ? state : { ...state, preset: action.preset };

    case "startRun": {
      if (locked) return state;
      const plan = buildRunPlan(state.selection);
      if (!plan || state.participants.length < plan.minParticipants) return state;
      return { ...state, run: createRun(action.id, plan, state.participants, state.preset, action.createdAt) };
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
