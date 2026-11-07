import { MEDICAL_RECORDS, isConsultationPackage } from "../domain/consultation";
import { availableResource } from "../domain/resources";
import { hrefOf, type Route } from "../state/route";
import type { State } from "../state/store";
import { PageHead } from "./common";
import { Panel } from "./console";

export default function HomePage({ state }: { state: State }) {
  const latest = state.tasks.find((task) => task.config.taskType === MEDICAL_RECORDS && task.status !== "canceled");
  const ready = state.datasets.some((dataset) => dataset.taskType === MEDICAL_RECORDS && dataset.ready && availableResource(dataset));
  const hasPackage = state.published.some(isConsultationPackage);
  let step: { title: string; body: string; label: string; route: Route };
  if (latest && (latest.status !== "completed" || !hasPackage)) {
    step = { title: "最近的经验任务", body: latest.name, label: "查看任务", route: { page: "task", id: latest.id } };
  } else if (hasPackage) {
    step = { title: "经验包已可用", body: "选择一个已发布的经验包，开始新的问诊。", label: "开始问诊", route: { page: "consultation" } };
  } else if (ready) {
    step = { title: "开始生成经验", body: "选择算法和可用的问诊记录，生成一个经验包。", label: "生成经验包", route: { page: "newTask" } };
  } else {
    step = { title: "上传问诊记录", body: "添加已有的问诊过程，校验后可用于生成经验。", label: "上传问诊记录", route: { page: "resources", upload: true } };
  }
  return (
    <>
      <PageHead title="工作台" meta="从已有问诊记录生成经验，再用新病例评测和试用。" />
      <Panel title={step.title} className="medical-next">
        <p>{step.body}</p>
        <div className="detail-actions">
          <a className="button button--primary" href={hrefOf(step.route)}>{step.label}</a>
          {step.route.page !== "consultation" ? (
            <a className="button button--secondary" href={hrefOf({ page: "consultation" })}>打开医疗问诊</a>
          ) : null}
        </div>
      </Panel>
    </>
  );
}
