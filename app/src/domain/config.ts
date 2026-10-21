/** 任务配置稳定入口；领域规则按职责维护，界面不直接依赖内部文件布局。 */
export {
  DEFAULT_DRAFT,
  withDefaults,
  type Draft,
  type AgentGroup,
  type Estimate,
  type Issue,
  type RunMode,
  type TaskConfig,
  type TaskParticipant,
} from "./task-config/types";
export {
  availableDataSources,
  canPickInto,
  chooseAlgorithm,
  chooseScenario,
  chooseTaskType,
  compatibleDatasets,
  joinable,
  pickDataset,
  setParticipants,
  type DataSourceChoice,
} from "./task-config/selection";
export {
  activeOverrides,
  defaultTaskName,
  toConfig,
  toDraft,
} from "./task-config/serialization";
export {
  configIssue,
  draftIssues,
  taskModelSummary,
} from "./task-config/validation";
