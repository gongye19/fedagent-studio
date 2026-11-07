import { type Dispatch } from "react";
import { type Route } from "../state/route";
import { taskOf, type Action, type State } from "../state/store";
import { ALGORITHMS, scenarioOf, type ScenarioId } from "../domain/catalog";
import AlgorithmPage from "../ui/AlgorithmPage";
import AlgorithmsPage from "../ui/AlgorithmsPage";
import ApplicationPage from "../ui/ApplicationPage";
import AppPage from "../ui/AppPage";
import AppsPage from "../ui/AppsPage";
import { EmptyState, NotFound, PageHead } from "../ui/common";
import EndpointPage from "../ui/EndpointPage";
import HomePage from "../ui/HomePage";
import AgentsPage from "../ui/AgentsPage";
import ModelsPage from "../ui/ModelsPage";
import NewDatasetPage from "../ui/NewDatasetPage";
import NewParticipantPage from "../ui/NewParticipantPage";
import TaskConfigPage from "../ui/TaskConfigPage";
import ParticipantsPage from "../ui/ParticipantsPage";
import ResourcesPage from "../ui/ResourcesPage";
import TaskPage from "../ui/TaskPage";
import TasksPage from "../ui/TasksPage";

export function PageRouter({ state, dispatch, route }: { state: State; dispatch: Dispatch<Action>; route: Route }) {
  switch (route.page) {
    case "tasks":
      return <TasksPage state={state} />;
    case "newTask":
      // 已支持场景复用注册表驱动的配置页；未接入算法的场景显示规划状态。
      return !route.scenario || scenarioOf(route.scenario).status === "available" ? (
        <TaskConfigPage state={state} dispatch={dispatch} initialScenario={route.scenario} application={route.application} />
      ) : (
        <PlannedTaskConfig scenario={route.scenario} />
      );
    case "resources":
      return route.kind === "models" ? <ModelsPage state={state} space={route.space} /> : route.kind === "agents" ? <AgentsPage space={route.space} /> : <ResourcesPage state={state} space={route.space} selectedId={route.id} />;
    case "task": {
      const task = taskOf(state, route.id);
      return task ? (
        <TaskPage key={task.id} task={task} state={state} dispatch={dispatch} tab={route.tab} />
      ) : (
        <NotFound kind="任务" back={{ page: "tasks" }} backLabel="联邦任务" />
      );
    }
    case "apps":
      return <AppsPage state={state} />;
    case "application":
      return <ApplicationPage state={state} taskType={route.taskType} />;
    case "app": {
      const item = state.published.find((entry) => entry.id === route.id);
      return item ? (
        <AppPage key={item.id} item={item} task={taskOf(state, item.taskId)} state={state} tab={route.tab} />
      ) : (
        <NotFound kind="应用" back={{ page: "apps" }} backLabel="应用" />
      );
    }
    case "participants":
      return <ParticipantsPage state={state} selectedId={route.id} />;
    case "newParticipant":
      return <NewParticipantPage state={state} dispatch={dispatch} from={route.from} />;
    case "newDataset":
      return (
        <NewDatasetPage
          key={route.participant ?? ""}
          state={state}
          dispatch={dispatch}
          participant={route.participant}
          from={route.from}
        />
      );
    case "algorithms": {
      if (!route.id) return <AlgorithmsPage />;
      const algorithm = ALGORITHMS.find((item) => item.id === route.id);
      return algorithm ? (
        <AlgorithmPage algorithm={algorithm} />
      ) : (
        <NotFound kind="算法" back={{ page: "algorithms" }} backLabel="算法列表" />
      );
    }
    case "models":
      return <ModelsPage state={state} space={route.space} />;
    case "agents":
      return <AgentsPage space={route.space} />;
    case "newEndpoint":
      return <EndpointPage state={state} from={route.from} />;
    case "editEndpoint":
      return <EndpointPage state={state} id={route.id} from={route.from} />;
    default:
      return <HomePage />;
  }
}

/** 还没有配置页的场景（算法规划中）：说明原因，回到任务列表。 */
function PlannedTaskConfig({ scenario }: { scenario: ScenarioId }) {
  const item = scenarioOf(scenario);
  return (
    <>
      <PageHead title={`新建${item.short}任务`} back={{ label: "联邦任务", route: { page: "tasks" } }} />
      <EmptyState title="暂时不能新建">
        <p>{item.short}的算法还在规划中，接入后在这里配置这个场景的任务。</p>
      </EmptyState>
    </>
  );
}
