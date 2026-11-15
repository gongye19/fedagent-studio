import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { EMPTY_SESSION } from "../../domain/lifestyle/fixtures";
import { demoMatches, demoUsers, reduceDemo } from "../../domain/lifestyle/simulation";
import { AppPreview } from "./AppPreview";
import { ExperiencePanel } from "./ExperiencePanel";

it("places the empty-state action outside its paragraph and uses the actual source count", () => {
  const html = renderToStaticMarkup(<ExperiencePanel experience={null} outdated={false} sourceCount={4} onGenerate={() => {}} onMatch={() => {}} />);
  expect(html).toContain("4");
  expect(html).not.toContain("已有 3");
  expect(html.indexOf("</p>")).toBeLessThan(html.indexOf("<button"));
  expect(html.match(/<p[ >]/g)).toHaveLength(1);
});

it("provides a next action in both initial and ready-to-match preview states", () => {
  const users = demoUsers(EMPTY_SESSION);
  const initial = renderToStaticMarkup(<AppPreview users={users} matches={[]} packageReady={false} onGenerate={() => {}} onMatch={() => {}} />);
  expect(initial).toContain("尚未运行用户匹配");
  expect(initial).toContain("生成演示经验包</button>");
  const ready = renderToStaticMarkup(<AppPreview users={users} matches={[]} packageReady onGenerate={() => {}} onMatch={() => {}} />);
  expect(ready).toContain("匹配用户</button>");
});

it("keeps preview selection in the header and notice details free of dangling controls", () => {
  const session = reduceDemo(reduceDemo(EMPTY_SESSION,{type:"generate",at:"2026-11-15T00:00:00Z"}),{type:"match",at:"2026-11-15T00:00:00Z"});
  const html = renderToStaticMarkup(<AppPreview users={demoUsers(session)} matches={demoMatches(session)} packageReady onGenerate={() => {}} onMatch={() => {}} />);
  expect(html.indexOf('id="lifestyle-preview-user"')).toBeLessThan(html.indexOf('class="panel-body"'));
  expect(html).toContain("有一项健康信息值得核实");
  expect(html).not.toContain('aria-controls="lifestyle-notice-detail"');
});
