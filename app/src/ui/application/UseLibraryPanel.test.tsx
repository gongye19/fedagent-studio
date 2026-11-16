import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import { applicationEntries, LIFESTYLE_RECORDS } from "../../domain/applications";
import { TASK_TYPES } from "../../domain/catalog";
import { applicationRoute, parseHash } from "../../state/route";
import type { Published, State } from "../../state/store";
import { DEFAULT_DRAFT } from "../../domain/config";
import { UseLibraryPanel } from "./UseLibraryPanel";

const state: State = { participants: [], datasets: [], endpoints: [], agents: [], tasks: [], published: [], draft: DEFAULT_DRAFT };
const definition = { label: "LifeStyle", metric: "建议评分", grader: "lifestyle-rubric", format: "", unlabeledNote: "", placeholder: "",
  structuredInput: true, recordBased: true, applicationGrading: false,
  inputFields: [{ key: "profile", label: "个人情况", required: true, kind: "textarea", help: "" },
    { key: "question", label: "问题", required: true, kind: "textarea", help: "" }] } as const;

afterEach(() => { delete TASK_TYPES[LIFESTYLE_RECORDS]; delete TASK_TYPES["test-medical"]; });

test("LifeStyle uses the registered application once and redirects old mock links", () => {
  TASK_TYPES[LIFESTYLE_RECORDS] = { ...definition, inputFields: [...definition.inputFields] };
  expect(applicationEntries().filter((entry) => entry.label === "LifeStyle")).toHaveLength(1);
  expect(parseHash("#/apps/lifestyle/preview")).toEqual({ page: "application", taskType: LIFESTYLE_RECORDS });
  expect(applicationRoute(LIFESTYLE_RECORDS)).toEqual(applicationRoute("lifestyle"));
});

test("recommendations hide gold-answer inputs, existing graded applications retain them", () => {
  TASK_TYPES[LIFESTYLE_RECORDS] = { ...definition, inputFields: [...definition.inputFields] };
  const item: Published = { id: "p", taskId: "t", name: "经验包", taskType: LIFESTYLE_RECORDS,
    algorithm: "fot-records", pluginVersion: "1.0.0", scenario: "horizontal", builtAfterRound: 1, publishedAt: "2026-11-17", items: [] };
  let html = renderToStaticMarkup(<UseLibraryPanel item={item} state={state} />);
  expect(html).toContain("个人情况");
  expect(html).toContain("运行对比");
  expect(html).not.toContain('id="try-answer"');
  TASK_TYPES["test-medical"] = { ...TASK_TYPES[LIFESTYLE_RECORDS], applicationGrading: true };
  html = renderToStaticMarkup(<UseLibraryPanel item={{ ...item, taskType: "test-medical" }} state={state} />);
  expect(html).toContain('id="try-answer"');
});
