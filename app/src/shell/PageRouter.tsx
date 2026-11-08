import { MEDICAL_RECORDS } from "../domain/consultation";
import { ConsultationPage } from "../ui/application/ConsultationPage";
import { type Dispatch } from "react";
import { type Route } from "../state/route";
import { taskOf, type Action, type State } from "../state/store";
import { ALGORITHMS } from "../domain/catalog";
import AlgorithmPage from "../ui/AlgorithmPage";
import AlgorithmsPage from "../ui/AlgorithmsPage";
import ApplicationPage from "../ui/ApplicationPage";
import AppPage from "../ui/AppPage";
import AppsPage from "../ui/AppsPage";
import { NotFound } from "../ui/common";
import EndpointPage from "../ui/EndpointPage";
import { EvaluationPage } from "../ui/evaluation/EvaluationPage";
import { EvaluationsPage } from "../ui/evaluation/EvaluationsPage";
import { NewEvaluationPage } from "../ui/evaluation/NewEvaluationPage";
import FederationResultsPage from "../ui/FederationResultsPage";
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
    case "results":
      return <FederationResultsPage state={state} />;
    case "evaluations":
      return <EvaluationsPage />;
    case "newEvaluation":
      return <NewEvaluationPage state={state} />;
    case "evaluation":
      return <EvaluationPage key={route.id} id={route.id} state={state} />;
    case "newTask":
      return <TaskConfigPage state={state} dispatch={dispatch} initialScenario={route.scenario}
        application={route.application} />;
    case "resources":
      return route.kind === "models" ? <ModelsPage state={state} space={route.space} /> : route.kind === "agents" ? <AgentsPage space={route.space} /> : <ResourcesPage state={state} selectedId={route.id} upload={route.upload} />;
    case "task": {
      const task = taskOf(state, route.id);
      return task ? (
        <TaskPage key={task.id} task={task} state={state} dispatch={dispatch} tab={route.tab} />
      ) : (
        <NotFound kind="任务" back={{ page: "tasks" }} backLabel="联邦任务" />
      );
    }
    case "consultation":
      return <ConsultationPage key={route.packageId ?? ""} state={state} packageId={route.packageId} />;
    case "apps":
      return <AppsPage />;
    case "application":
      return route.taskType === MEDICAL_RECORDS ? <ConsultationPage state={state} /> : <ApplicationPage state={state} taskType={route.taskType} />;
    case "app": {
      const item = state.published.find((entry) => entry.id === route.id);
      if (item?.taskType === MEDICAL_RECORDS && (!route.tab || route.tab === "try")) {
        return <ConsultationPage key={item.id} state={state} packageId={item.id} />;
      }
      return item ? (
        <AppPage key={item.id} item={item} task={taskOf(state, item.taskId)} state={state} tab={route.tab} />
      ) : (
        <NotFound kind="成果" back={{ page: "results" }} backLabel="联邦成果" />
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
      return <ResourcesPage state={state} />;
  }
}
