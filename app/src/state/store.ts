// 页面使用通用工作负载配置驱动向导；下方的旧字段继续支撑 LoRA mock 执行链路。
// 真实后端接入后，两者应统一为版本化 RunSpec，避免前端状态成为服务端契约。

import { narrowArtifacts, narrowEvaluations, narrowPrivacies } from "../domain/compatibility";
import {
  INITIAL_CONFIGURATION,
  configurationFor,
  isConfigurationReady,
  type FederationConfiguration,
} from "../domain/configuration";
import { EVALUATIONS, methodOf } from "../domain/registry";
import { SEED_ARTIFACTS, artifactOf } from "../domain/repository";
import { LORA_FEDERATION_SCENARIO } from "../domain/scenario";
import {
  attachResult, failRun, finishStage, startStage,
  type Run, type RunResult, type StageId,
} from "../domain/run";
import type { Artifact, Recipe } from "../domain/types";

export type State = {
  artifacts: Artifact[];
  configuration: FederationConfiguration;
  federationMethodId: string | null;
  dataTypeId: string | null;
  baseModelId: string | null;
  rankId: string | null;
  methodId: string | null;
  artifactIds: string[];
  privacyId: string | null;
  run: Run | null;
};

function matchingSampleIds(
  artifacts: Artifact[],
  dataTypeId: string | null,
  baseModelId: string | null,
  rankId: string | null,
): string[] {
  const model = LORA_FEDERATION_SCENARIO.baseModelOptions.find((item) => item.id === baseModelId);
  const rank = LORA_FEDERATION_SCENARIO.rankOptions.find((item) => item.id === rankId);
  if (!dataTypeId || !model || !rank) return [];

  return LORA_FEDERATION_SCENARIO.sampleArtifactIds.filter((id) => {
    const artifact = artifactOf(artifacts, id);
    return Boolean(
      artifact
      && artifact.objectType === dataTypeId
      && artifact.architecture === model.architecture
      && artifact.baseCheckpoint === model.checkpoint
      && artifact.rank === rank.value,
    );
  });
}

export const initialState: State = {
  artifacts: SEED_ARTIFACTS,
  configuration: INITIAL_CONFIGURATION,
  federationMethodId: LORA_FEDERATION_SCENARIO.federationMethodId,
  dataTypeId: LORA_FEDERATION_SCENARIO.dataTypeId,
  baseModelId: LORA_FEDERATION_SCENARIO.baseModelId,
  rankId: LORA_FEDERATION_SCENARIO.rankId,
  methodId: LORA_FEDERATION_SCENARIO.methodId,
  artifactIds: matchingSampleIds(
    SEED_ARTIFACTS,
    LORA_FEDERATION_SCENARIO.dataTypeId,
    LORA_FEDERATION_SCENARIO.baseModelId,
    LORA_FEDERATION_SCENARIO.rankId,
  ),
  privacyId: LORA_FEDERATION_SCENARIO.privacyId,
  run: null,
};

export type Action =
  | { type: "setWorkload"; id: string }
  | { type: "setPartition"; id: string }
  | { type: "setTopology"; id: string }
  | { type: "setStrategy"; id: string }
  | { type: "setProtection"; id: string }
  | { type: "setWorkloadSetting"; key: string; value: string }
  | { type: "setFederationMethod"; id: string }
  | { type: "setDataType"; id: string }
  | { type: "setBaseModel"; id: string }
  | { type: "setRank"; id: string }
  | { type: "setMethod"; id: string }
  | { type: "toggleArtifact"; id: string }
  | { type: "stageArtifact"; artifact: Artifact }
  | { type: "setPrivacy"; id: string }
  | { type: "reset" }
  | { type: "startRun"; run: Run }
  | { type: "stageStart"; stage: StageId }
  | { type: "stageFinish"; stage: StageId; detail: string }
  | { type: "stageFail"; stage: StageId; error: string }
  | { type: "runResult"; result: RunResult; artifact: Artifact };

export function selectedArtifacts(state: State): Artifact[] {
  return state.artifactIds
    .map((id) => artifactOf(state.artifacts, id))
    .filter((item): item is Artifact => Boolean(item));
}

/** 评测方案按对象类型自动定，不占一个选择步骤。 */
export function evaluationFor(selected: Artifact[]) {
  const allowed = narrowEvaluations(selected).allowed;
  return allowed[0] ?? EVALUATIONS[0];
}

export function recipeOf(state: State): Recipe | null {
  const selected = selectedArtifacts(state);
  const model = LORA_FEDERATION_SCENARIO.baseModelOptions.find((item) => item.id === state.baseModelId);
  const rank = LORA_FEDERATION_SCENARIO.rankOptions.find((item) => item.id === state.rankId);
  if (
    !isConfigurationReady(state.configuration)
    ||
    !state.federationMethodId
    || !state.dataTypeId
    || !model
    || !rank
    || !state.methodId
    || !state.privacyId
    || selected.length < LORA_FEDERATION_SCENARIO.inputContract.minParticipants
    || selected.some((item) => (
      item.objectType !== state.dataTypeId
      || item.architecture !== model.architecture
      || item.baseCheckpoint !== model.checkpoint
      || item.rank !== rank.value
    ))
  ) return null;
  return {
    artifactIds: state.artifactIds,
    methodId: state.methodId,
    privacyId: state.privacyId,
    datasetId: LORA_FEDERATION_SCENARIO.datasetId,
    evaluationId: LORA_FEDERATION_SCENARIO.evaluationId,
  };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "setWorkload":
      return { ...state, configuration: configurationFor(action.id) };

    case "setPartition":
      return {
        ...state,
        configuration: { ...state.configuration, partitionId: action.id },
      };

    case "setTopology":
      return {
        ...state,
        configuration: { ...state.configuration, topologyId: action.id },
      };

    case "setStrategy":
      return {
        ...state,
        configuration: { ...state.configuration, strategyId: action.id },
      };

    case "setProtection":
      return {
        ...state,
        configuration: { ...state.configuration, protectionId: action.id },
      };

    case "setWorkloadSetting":
      return {
        ...state,
        configuration: {
          ...state.configuration,
          settings: { ...state.configuration.settings, [action.key]: action.value },
        },
      };

    case "setFederationMethod":
      return {
        ...state,
        federationMethodId: action.id,
        artifactIds: action.id === LORA_FEDERATION_SCENARIO.federationMethodId
          ? matchingSampleIds(state.artifacts, state.dataTypeId, state.baseModelId, state.rankId)
          : [],
      };

    case "setDataType":
      return {
        ...state,
        dataTypeId: action.id,
        artifactIds: matchingSampleIds(state.artifacts, action.id, state.baseModelId, state.rankId),
      };

    case "setBaseModel":
      return {
        ...state,
        baseModelId: action.id,
        artifactIds: matchingSampleIds(state.artifacts, state.dataTypeId, action.id, state.rankId),
      };

    case "setRank":
      return {
        ...state,
        rankId: action.id,
        artifactIds: matchingSampleIds(state.artifacts, state.dataTypeId, state.baseModelId, action.id),
      };

    case "setMethod": {
      const method = methodOf(action.id);
      // 换方法可能让已选的数据或加密方式失效。不替用户改选，只把失效的清掉。
      const stillOk = narrowArtifacts(state.artifacts, state.artifactIds, method).allowed;
      const artifactIds = state.artifactIds.filter((id) => stillOk.some((item) => item.id === id));
      const privacyOk = narrowPrivacies(method).allowed.some((item) => item.id === state.privacyId);
      return {
        ...state,
        methodId: action.id,
        artifactIds,
        privacyId: privacyOk ? state.privacyId : null,
      };
    }

    case "toggleArtifact": {
      const has = state.artifactIds.includes(action.id);
      return {
        ...state,
        artifactIds: has
          ? state.artifactIds.filter((id) => id !== action.id)
          : [...state.artifactIds, action.id],
      };
    }

    case "stageArtifact": {
      const exists = state.artifacts.some((item) => item.id === action.artifact.id);
      return {
        ...state,
        artifacts: exists
          ? state.artifacts.map((item) => item.id === action.artifact.id ? action.artifact : item)
          : [action.artifact, ...state.artifacts],
        artifactIds: state.artifactIds.includes(action.artifact.id)
          ? state.artifactIds
          : [...state.artifactIds, action.artifact.id],
      };
    }

    case "setPrivacy":
      return { ...state, privacyId: action.id };

    case "reset":
      return { ...initialState, artifacts: state.artifacts };

    case "startRun":
      return { ...state, run: action.run };

    case "stageStart":
      return state.run ? { ...state, run: startStage(state.run, action.stage) } : state;

    case "stageFinish":
      return state.run
        ? { ...state, run: finishStage(state.run, action.stage, action.detail) }
        : state;

    case "stageFail":
      return state.run ? { ...state, run: failRun(state.run, action.stage, action.error) } : state;

    case "runResult":
      return state.run
        ? {
            ...state,
            run: attachResult(state.run, action.result),
            // 产出的版本进仓库，可以作为下一次联邦的输入。
            artifacts: [action.artifact, ...state.artifacts],
          }
        : state;

    default:
      return state;
  }
}
