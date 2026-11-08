import { useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
} from "react";
import { api, ApiError } from "../../api/client";
import { algorithmOf, recordTaskTypesFor, scenarioOf, type ScenarioId } from "../../domain/catalog";
import {
  activeOverrides,
  availableDataSources,
  configIssue,
  defaultTaskName,
  draftIssues,
  joinable,
  trialSampleBounds,
  type Draft,
  type Estimate,
  type Issue,
} from "../../domain/config";
import { DEFAULT_ENDPOINT_ID, endpointOf } from "../../domain/resources";
import { createTask, taskRequest } from "../../state/actions";
import { showFlash } from "../../state/flash";
import { navigate } from "../../state/route";
import { type Action, type State } from "../../state/store";
import { useTaskCheck } from "./useTaskCheck";
import { useDebounced } from "../hooks";

type Pending = "full" | "restart" | null;

export function useTaskConfig(
  state: State,
  dispatch: Dispatch<Action>,
  initialScenario?: ScenarioId,
  application?: string,
) {
  const draft = state.draft;
  // 没动过的草稿不保留：每次打开都按当前的参与方和数据重新选，默认名称按当前任务类型生成。
  const resetOnOpen = useRef(!draft.touched);
  const [pending, setPending] = useState<Pending>(null);
  const [attempted, setAttempted] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!resetOnOpen.current) return;
    resetOnOpen.current = false;
    dispatch({ type: "resetDraft" });
  }, [dispatch]);

  useEffect(() => {
    if (!initialScenario) return;
    dispatch({ type: "chooseScenario", scenario: initialScenario, auto: true });
    if (application && recordTaskTypesFor(initialScenario).includes(application))
      dispatch({ type: "chooseTaskType", taskType: application });
  }, [dispatch, initialScenario, application]);

  function selectScenario(id: Draft["scenario"]) {
    dispatch({ type: "chooseScenario", scenario: id });
    if (application && recordTaskTypesFor(id).includes(application))
      dispatch({ type: "chooseTaskType", taskType: application });
    if (initialScenario && id !== initialScenario) navigate({ page: "newTask" }, { keepScroll: true });
  }

  function selectTaskType(taskType: Draft["taskType"]) {
    dispatch({ type: "chooseTaskType", taskType });
  }

  function selectAlgorithm(id: Draft["algorithm"]) {
    dispatch({ type: "chooseAlgorithm", algorithm: id });
  }

  const update = (patch: Partial<Draft>) =>
    dispatch({ type: "updateDraft", patch });
  const algorithm = draft.algorithm ? algorithmOf(draft.algorithm) : null;
  useEffect(() => {
    if (!algorithm) return;
    if (algorithm.minRounds === algorithm.maxRounds && draft.rounds !== algorithm.defaultRounds)
      dispatch({ type: "updateDraft", patch: { rounds: algorithm.defaultRounds } });
    if (algorithm.requirements.agentRequired && draft.execution !== "agent")
      dispatch({
        type: "updateDraft",
        patch: { execution: "agent", clientOverrides: {} },
      });
    else if (
      !algorithm.requirements.executionModes.includes("agent") &&
      (draft.execution === "agent" ||
        draft.agentId ||
        Object.keys(draft.agentOverrides ?? {}).length)
    )
      dispatch({
        type: "updateDraft",
        patch: {
          execution: "builtin",
          agentId: null,
          agentOverrides: {},
          agentGroups: [],
        },
      });
  }, [
    algorithm,
    draft.execution,
    draft.rounds,
    draft.agentId,
    draft.agentOverrides,
    dispatch,
  ]);
  // 能参加的参与方：名下有登记在这个场景、这种任务类型下的数据集。
  const scenarioId = draft.scenario;
  const scenarioPlanned = scenarioId !== null && scenarioOf(scenarioId).status === "planned";
  const taskType = draft.taskType;
  const candidates = availableDataSources(
    draft,
    state.datasets,
    state.participants,
  );
  const joined = joinable(draft, state.datasets, state.participants);
  const sampleBounds = trialSampleBounds(draft, state.datasets);
  const localIssues = draftIssues(
    draft,
    state.datasets,
    state.participants,
    state.endpoints,
    state.agents,
  );
  // 预估和最终的检查由后端做（插件声明的步骤、接口单价、模型接口是否配置好）；配置改动停下 0.3 秒后再问一次。
  const currentRequest = taskRequest(
    draft,
    "",
    state.datasets,
    state.participants,
  );
  // 资源变动同样使测试失效；后台刷新内容一致时不改变签名。
  const resourceVersion = JSON.stringify([
    state.datasets
      .filter((d) =>
        currentRequest?.participants.some((p) => p.datasetId === d.id),
      )
      .map((d) => [d.id, d.ownerId, d.shared, d.sourceHash, d.count]),
    state.agents
      .filter((a) =>
        Object.values(currentRequest?.agentOverrides ?? {}).includes(a.id),
      )
      .map((a) => [a.id, a.ownerId, a.shared, a.revision]),
    state.endpoints.map((e) => [
      e.id,
      e.baseUrl,
      e.models,
      e.hasKey,
      e.shared,
      e.price,
    ]),
  ]);
  const request = useDebounced(currentRequest, 300);
  const requestCurrent =
    JSON.stringify(request) === JSON.stringify(currentRequest);
  const check = useQuery({
    queryKey: ["task-validate", request, resourceVersion],
    queryFn: () => {
      if (!request) throw new Error("Missing task configuration");
      return api.validateTask(request);
    },
    enabled: Boolean(request && request.participants.length),
    staleTime: 15_000,
  });
  const validationPending =
    !localIssues.length &&
    (!requestCurrent || check.isPending || check.isFetching);
  const validationError =
    !localIssues.length && requestCurrent && check.error
      ? check.error instanceof ApiError
        ? check.error.message
        : "无法检查配置，请稍后重试"
      : null;
  const serverIssues =
    localIssues.length || !requestCurrent || !request?.participants.length
      ? []
      : (check.data?.issues ?? []);
  const issues: Issue[] = [
    ...localIssues,
    ...serverIssues
      .map(configIssue)
      .filter(
        (issue) => !localIssues.some((item) => item.message === issue.message),
      ),
  ];
  const result: Estimate | null =
    joined.length && requestCurrent && !check.error
      ? (check.data?.estimate ?? null)
      : null;
  const canTest =
    !issues.length && !validationPending && !validationError && Boolean(result);
  const preflight = useTaskCheck(currentRequest, canTest, resourceVersion);
  const canCreate = canTest && preflight.valid;
  if (attempted && canTest && !preflight.valid && !preflight.running)
    issues.push({
      field: "check",
      message:
        preflight.matches && preflight.report?.status === "failed"
          ? "请修正连接问题后重新检查"
          : "请先检查资源连接，再开始任务",
    });
  const fieldError = (field: Issue["field"]) =>
    attempted
      ? issues
          .filter((issue) => issue.field === field)
          .map((issue) => issue.message)
          .join("；") || undefined
      : undefined;
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const full = draft.mode === "full";
  const autoName = defaultTaskName(draft);
  const overrideCount =
    draft.execution === "agent"
      ? Object.keys(draft.agentOverrides ?? {}).filter((id) =>
          joined.some((p) => p.participantId === id),
        ).length
      : Object.keys(activeOverrides(draft)).length;
  const priceEndpoint =
    endpointOf(draft.clientModel, state.endpoints)?.id ?? DEFAULT_ENDPOINT_ID;

  async function create() {
    if (!canCreate || creating) return;
    const body = taskRequest(
      draft,
      draft.name?.trim() || defaultTaskName(draft),
      state.datasets,
      state.participants,
    );
    if (!body) return;
    setCreating(true);
    setCreateError(null);
    try {
      const task = await createTask({ ...body, checkId: preflight.id });
      dispatch({ type: "resetDraft" });
      showFlash(
        { page: "task", id: task.id },
        full
          ? `已创建“${task.name}”，开始正式运行。`
          : `已创建“${task.name}”，开始试跑。`,
      );
      navigate({ page: "task", id: task.id });
    } catch (error) {
      setCreateError(
        error instanceof ApiError ? error.message : "创建失败，稍后再试",
      );
    } finally {
      setCreating(false);
    }
  }

  function restart() {
    dispatch({ type: "resetDraft" });
    setPending(null);
    setAttempted(false);
    setCreateError(null);
    navigate({ page: "newTask" });
  }

  /** 缺项在尝试开始时原位提示；最终创建仍以服务端校验为准。 */
  function start(event: MouseEvent<HTMLButtonElement>) {
    if (scenarioPlanned || creating || validationPending) return;
    if (!canCreate) {
      setAttempted(true);
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (!reduced) {
        event.currentTarget
          .getAnimations()
          .forEach((animation) => animation.cancel());
        event.currentTarget.animate(
          [
            { transform: "translateX(0)" },
            { transform: "translateX(-4px)" },
            { transform: "translateX(4px)" },
            { transform: "translateX(-2px)" },
            { transform: "translateX(0)" },
          ],
          { duration: 260, easing: "ease-out" },
        );
      }
      requestAnimationFrame(() => {
        const error =
          formRef.current?.querySelector<HTMLElement>(".field-error");
        const region = error?.closest(".field, section, details");
        const disclosure = error?.closest("details");
        if (disclosure) disclosure.open = true;
        if (!region || !error) return;
        error.scrollIntoView({
          block: "center",
          behavior: reduced ? "instant" : "smooth",
        });
        const control =
          region.matches("details") || error.id === "models-error"
            ? null
            : (region.querySelector<HTMLElement>(
                'input:not(:disabled):not([type="hidden"]), button[role="radio"]:not(:disabled), [role="combobox"]:not(:disabled)',
              ) ??
              region.querySelector<HTMLElement>(
                "button:not(:disabled):not(.info-tip-trigger), a",
              ));
        if (control) control.focus({ preventScroll: true });
        else {
          error.tabIndex = -1;
          error.focus({ preventScroll: true });
        }
      });
      return;
    }
    if (full) {
      setCreateError(null);
      setPending("full");
    } else void create();
  }

  function testConfiguration(event: MouseEvent<HTMLButtonElement>) {
    if (!canTest) {
      start(event);
      return;
    }
    setCreateError(null);
    void preflight.test();
  }

  const startLabel = full ? "创建并正式运行" : "创建并试跑";
  return {
    draft,
    pending,
    setPending,
    formRef,
    selectScenario,
    selectTaskType,
    selectAlgorithm,
    update,
    algorithm,
    scenarioId,
    scenarioPlanned,
    taskType,
    candidates,
    joined,
    result,
    sampleBounds,
    canCreate,
    canTest,
    preflight,
    testConfiguration,
    fieldError,
    creating,
    createError,
    setCreateError,
    full,
    autoName,
    overrideCount,
    priceEndpoint,
    create,
    restart,
    start,
    startLabel,
    validationPending,
    validationError,
    issues,
    check,
  };
}

export type TaskConfigController = ReturnType<typeof useTaskConfig>;
