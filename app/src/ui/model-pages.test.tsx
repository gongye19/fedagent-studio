import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ENDPOINTS } from "../test/fixtures";
import { DEFAULT_DRAFT, chooseAlgorithm, chooseTaskType, draftIssues } from "../domain/config";
import { usableModelOptions, type Endpoint } from "../domain/resources";
import type { State } from "../state/store";
import EndpointPage from "./EndpointPage";
import ModelsPage from "./ModelsPage";
import { ConsultationWindow } from "./application/ConsultationWindow";
import { ConsultationComparisonPage } from "./application/ConsultationComparisonPage";
import { NewEvaluationPage } from "./evaluation/NewEvaluationPage";

const platform: Endpoint = { ...ENDPOINTS[0], configured: true, verified: true, models: ["platform-model"] };
const own: Endpoint = { ...platform, id: "own", builtin: false, resourceSpace: "workspace", name: "自己的接口", models: ["own-model"] };
const state: State = { endpoints: [own, platform], participants: [], datasets: [], agents: [], tasks: [], published: [], draft: DEFAULT_DRAFT };
function render(children: React.ReactNode) {
  return renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>);
}
function windowWith(model: string) {
  return render(<ConsultationWindow window={{ id: 1, packageId: "", model }} title="问诊 1" active packages={[]}
    models={usableModelOptions(state.endpoints)} defaultModel="default" samples={[]} closeDisabled={false}
    onClose={() => {}} onStart={() => {}} onSettings={() => {}} />);
}

it("consultation windows use platform default but do not replace an unavailable explicit model", () => {
  expect(windowWith("")).toContain('title="默认 LLM 接口 · platform-model"');
  const unavailable = windowWith("deleted:model");
  expect(unavailable).toContain('>所选模型不可用<');
  expect(unavailable).not.toContain('title="默认 LLM 接口 · platform-model"');
});
it("evaluation and live comparison setup preselect the platform model", () => {
  expect(render(<NewEvaluationPage state={state} />)).toContain('name="model" value="default"');
  expect(render(<ConsultationComparisonPage id="new" state={state} />)).toContain('title="默认 LLM 接口 · platform-model"');
});
it("legacy platform edit entry renders read-only and personal entry remains editable", () => {
  const html = render(<EndpointPage state={state} id="default" />);
  expect(html).toContain("平台默认模型");
  expect(html).not.toContain('id="endpoint-url"');
  expect(html).toContain('href="#/models"');
  expect(render(<EndpointPage state={state} id="own" />)).toContain('id="endpoint-url"');
});
it("the unified directory exposes only personal editing and retains legacy sharing revocation", () => {
  const html = render(<ModelsPage state={{ ...state, endpoints: [{ ...own, shared: true }, platform] }} />);
  expect(html).toContain("平台默认");
  expect(html).not.toContain("我的资源");
  expect(html).toContain("自行接入 · 已共享");
  expect(html).toContain("取消共享");
  expect(html).toContain('#/models/own/edit');
  expect(html).not.toContain('#/models/default/edit');
});
it("an unavailable platform model points to maintenance rather than an impossible editing action", () => {
  const draft = chooseTaskType(chooseAlgorithm({ ...DEFAULT_DRAFT }, "fot-records"), "medical-records");
  const issues = draftIssues(draft, [], [], [{ ...platform, verified: false }]);
  expect(issues.some((issue) => issue.message.includes("联系平台管理员"))).toBe(true);
});
