import { DEMO_USERS, EMPTY_SESSION, UPLOAD_VALUES } from "./fixtures";
import type { DemoAction, DemoExperience, DemoMatch, DemoSession, DemoUser } from "./types";

export function demoUsers(session: DemoSession): DemoUser[] {
  return DEMO_USERS.map((user) => ({...user, report:user.report ?? (session.uploads[user.id]
    ? {value:UPLOAD_VALUES[user.id], examinedAt:"2026-11-15", uploadedAt:session.uploads[user.id]} : null)}));
}
export function bmi(user: DemoUser): number | null {
  return user.height && user.weight ? user.weight / (user.height / 100) ** 2 : null;
}
export function matchesDemoRule(user: DemoUser): boolean | null {
  const value = bmi(user);
  return value === null || user.activityDays === null ? null : value >= 25 && user.activityDays <= 1;
}
export function sourceIds(users: readonly DemoUser[]) {
  return users.filter((user) => user.report && matchesDemoRule(user) === true).map((user) => user.id);
}
function packageId(ids: readonly string[]) { return `lifestyle-demo:${ids.join(",")}`; }

/** 预设规则演示，不调用 LLM／FoT，不宣称从这些样本发现临床规律。 */
export function demoExperience(session: DemoSession): DemoExperience | null {
  if (!session.generation) return null;
  const sources = demoUsers(session).filter((user) => session.generation!.sources.includes(user.id));
  return {id:packageId(session.generation.sources),createdAt:session.generation.at,sources,
    supporting:sources.filter((user) => user.report!.value > 1.7).length,
    counterexamples:sources.filter((user) => user.report!.value <= 1.7).length};
}
export function packageOutdated(session: DemoSession) {
  return Boolean(session.generation && packageId(sourceIds(demoUsers(session))) !== packageId(session.generation.sources));
}
export function demoMatches(session: DemoSession): DemoMatch[] {
  const experience = demoExperience(session);
  if (!experience || packageOutdated(session) || session.matching?.packageId !== experience.id) return [];
  return demoUsers(session).map((user) => ({user,at:session.matching!.at,packageId:experience.id,
    status:user.report ? "reported" : matchesDemoRule(user) === null ? "insufficient" : matchesDemoRule(user) ? "attention" : "unmatched"}));
}

export function reduceDemo(session: DemoSession, action: DemoAction): DemoSession {
  if (action.type === "reset") return EMPTY_SESSION;
  if (action.type === "upload") {
    if (!Object.hasOwn(UPLOAD_VALUES,action.id) || session.uploads[action.id]) return session;
    return {...session,uploads:{...session.uploads,[action.id]:action.at},matching:null};
  }
  const sources = sourceIds(demoUsers(session));
  if (action.type === "generate") {
    if (sources.length < 2 || session.generation && !packageOutdated(session)) return session;
    return {...session,generation:{at:action.at,sources},matching:null};
  }
  if (!session.generation || packageOutdated(session)) return session;
  const id = packageId(session.generation.sources);
  return session.matching?.packageId === id ? session : {...session,matching:{at:action.at,packageId:id}};
}

/** 只恢复预定义虚构用户的操作；不把浏览器数据当成真实资源。 */
export function parseDemoSession(raw: string | null): DemoSession {
  if (!raw) return EMPTY_SESSION;
  try {
    const value = JSON.parse(raw);
    const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
    if (value?.version !== 1 || !value.uploads || typeof value.uploads !== "object" || Array.isArray(value.uploads)) return EMPTY_SESSION;
    const uploads: Record<string,string> = {};
    for (const [id,at] of Object.entries(value.uploads)) {
      if (!Object.hasOwn(UPLOAD_VALUES,id) || !date(at)) return EMPTY_SESSION;
      uploads[id] = at;
    }
    const session: DemoSession = {version:1,uploads,generation:null,matching:null};
    if (value.generation !== null) {
      const g = value.generation;
      const eligible = sourceIds(demoUsers(session));
      if (!g || !date(g.at) || !Array.isArray(g.sources) || g.sources.length < 2 || new Set(g.sources).size !== g.sources.length
        || !g.sources.every((id: unknown) => typeof id === "string" && eligible.includes(id))) return EMPTY_SESSION;
      session.generation = {at:g.at,sources:g.sources};
    }
    if (value.matching !== null) {
      const m = value.matching;
      if (!m || !date(m.at) || !session.generation || m.packageId !== packageId(session.generation.sources)) return EMPTY_SESSION;
      session.matching = {at:m.at,packageId:m.packageId};
    }
    return session;
  } catch { return EMPTY_SESSION; }
}
