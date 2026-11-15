export type DemoReport = { value: number; examinedAt: string; uploadedAt: string };
export type DemoUser = {
  id: string; name: string; age: number; sex: string; height: number | null;
  weight: number | null; activityDays: number | null; sleepHours: number;
  updatedAt: string; report: DemoReport | null;
};
export type Generation = { at: string; sources: string[] };
export type DemoSession = {
  version: 1; uploads: Record<string, string>; generation: Generation | null;
  matching: { at: string; packageId: string } | null;
};
export type DemoExperience = {
  id: string; createdAt: string; sources: DemoUser[];
  supporting: number; counterexamples: number;
};
export type MatchStatus = "attention" | "unmatched" | "insufficient" | "reported";
export type DemoMatch = { user: DemoUser; status: MatchStatus; at: string; packageId: string };
export type DemoAction = { type: "upload"; id: string; at: string } | { type: "generate" | "match"; at: string } | { type: "reset" };
