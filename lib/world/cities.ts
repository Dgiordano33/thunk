// How a project reads as a city on the home map. Pure; no server imports.
import type { ProjectSummary } from "../projects/types";

export type CityLevel = 1 | 2 | 3 | 4 | 5;
export type CityMood = "settled" | "dormant";

/** Score needed to reach levels 2..5. Score is `workspaces * 2 + sessions`. */
export const LEVEL_THRESHOLDS = [2, 6, 14, 30] as const;
export const LEVEL_NAMES = ["Hamlet", "Village", "Town", "City", "Metropolis"] as const;
export const DORMANT_AFTER_DAYS = 30;

export const cityScore = (p: Pick<ProjectSummary, "workspaceCount" | "sessionCount">) => p.workspaceCount * 2 + p.sessionCount;

export function cityLevel(p: Pick<ProjectSummary, "workspaceCount" | "sessionCount">): CityLevel {
  const score = cityScore(p);
  const reached = LEVEL_THRESHOLDS.filter((t) => score >= t).length;
  return (reached + 1) as CityLevel;
}

export function cityMood(p: Pick<ProjectSummary, "lastActivityAt">, now: number = Date.now()): CityMood {
  if (!p.lastActivityAt) return "dormant";
  return now - Date.parse(p.lastActivityAt) > DORMANT_AFTER_DAYS * 86_400_000 ? "dormant" : "settled";
}

/** Stable hue in [0, 360) for a city's banner and borders. */
export function cityHue(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return (h >>> 0) % 360;
}

export type CityActivity = "Needs attention" | "Session error" | "Running" | null;

/** Live state across a project's sessions, most urgent first. Mirrors `workspaceActivity`. */
export function cityActivity(sessions: { projectId: string; status: string; pending: number }[], projectId: string): CityActivity {
  const rows = sessions.filter((s) => s.projectId === projectId);
  if (rows.some((s) => s.pending > 0 || s.status === "awaiting")) return "Needs attention";
  if (rows.some((s) => s.status === "error")) return "Session error";
  if (rows.some((s) => s.status === "running" || s.status === "starting")) return "Running";
  return null;
}

/** Everything the map needs to draw one city; computed on the server so render stays pure. */
export type WorldCity = {
  project: ProjectSummary;
  col: number;
  row: number;
  level: CityLevel;
  mood: CityMood;
  hue: number;
  territory: { col: number; row: number }[];
};
