import { expect, it } from "vitest";
import { EMPTY_SESSION } from "./fixtures";
import { demoExperience, demoMatches, demoUsers, packageOutdated, parseDemoSession, reduceDemo } from "./simulation";
import { applicationEntries } from "../applications";
import { applicationRoute, hrefOf, pageKeyOf, parseHash } from "../../state/route";
import "../../test/fixtures";

const at = "2026-11-15T05:00:00Z";

it("keeps the mock application separate from runnable task types and round-trips its routes", () => {
  expect(applicationEntries().filter((item) => item.demo).map((item) => item.id)).toEqual(["lifestyle"]);
  expect(applicationRoute("lifestyle")).toEqual({page:"lifestyle"});
  for (const route of [{page:"lifestyle"} as const,{page:"lifestyle",tab:"experience"} as const,
    {page:"lifestyle",tab:"preview"} as const,{page:"lifestyle",userId:"ls-04"} as const]) {
    expect(parseHash(hrefOf(route))).toEqual(route);
  }
  expect(pageKeyOf({page:"lifestyle",userId:"ls-04"})).not.toBe(pageKeyOf({page:"lifestyle"}));
});

it("derives mock evidence from actual fixture reports and retains the normal counterexample", () => {
  expect(demoExperience(EMPTY_SESSION)).toBeNull();
  expect(demoMatches(reduceDemo(EMPTY_SESSION,{type:"match",at}))).toEqual([]);
  const session = reduceDemo(EMPTY_SESSION,{type:"generate",at});
  const experience = demoExperience(session)!;
  expect(experience.sources.map((item) => item.id)).toEqual(["ls-01","ls-02","ls-03"]);
  expect([experience.supporting,experience.counterexamples]).toEqual([2,1]);
  expect(reduceDemo(session,{type:"generate",at:"2026-11-16T00:00:00Z"})).toBe(session);
});

it("matches another user without reading a future report and keeps missing data distinct", () => {
  let session = reduceDemo(EMPTY_SESSION,{type:"generate",at});
  session = reduceDemo(session,{type:"match",at});
  expect(demoMatches(session).map((item) => [item.user.id,item.status])).toEqual([
    ["ls-01","reported"],["ls-02","reported"],["ls-03","reported"],
    ["ls-04","attention"],["ls-05","unmatched"],["ls-06","insufficient"],
  ]);
  expect(reduceDemo(session,{type:"match",at:"2026-11-16T00:00:00Z"})).toBe(session);
});

it("invalidates stale matches on upload, freezes source reports and only includes eligible new cases", () => {
  let session = reduceDemo(reduceDemo(EMPTY_SESSION,{type:"generate",at}),{type:"match",at});
  session = reduceDemo(session,{type:"upload",id:"ls-04",at});
  expect(demoUsers(session).find((user) => user.id === "ls-04")?.report?.uploadedAt).toBe(at);
  expect(packageOutdated(session)).toBe(true);
  expect(demoExperience(session)?.sources).toHaveLength(3);
  expect(demoMatches(reduceDemo(session,{type:"match",at}))).toEqual([]);
  session = reduceDemo(session,{type:"generate",at});
  expect(demoExperience(session)?.sources).toHaveLength(4);
  expect(demoMatches(reduceDemo(session,{type:"match",at})).find((item) => item.user.id === "ls-04")?.status).toBe("reported");
  session = reduceDemo(session,{type:"upload",id:"ls-06",at});
  expect(packageOutdated(session)).toBe(false);
});

it("restores only valid isolated demo state, rejects corrupt references and resets all mock changes", () => {
  let session = reduceDemo(EMPTY_SESSION,{type:"upload",id:"ls-04",at});
  session = reduceDemo(reduceDemo(session,{type:"generate",at}),{type:"match",at});
  expect(parseDemoSession(JSON.stringify(session))).toEqual(session);
  for (const raw of ["broken","null",JSON.stringify({...session,uploads:{realUser:at}}),
    JSON.stringify({...session,generation:{at,sources:["ls-01","ls-01"]}}),
    JSON.stringify({...session,matching:{at,packageId:"real-package"}})]) {
    expect(parseDemoSession(raw)).toEqual(EMPTY_SESSION);
  }
  expect(reduceDemo(session,{type:"reset"})).toEqual(EMPTY_SESSION);
  expect(reduceDemo(session,{type:"upload",id:"unknown",at})).toBe(session);
});
