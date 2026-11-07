import type { HarnessEvent } from "../agent/types";
import type { ActivitySession, UsageEntry, UsageSummary } from "./types";

export function noticeFor(event: HarnessEvent): string | null {
  switch (event.type) {
    case "permission_request": return "Needs permission";
    case "ask_question": return "Has a question";
    case "plan_proposed": return "Plan ready for review";
    case "result": return event.isError ? "Turn failed" : "Turn finished";
    case "error": return "Session error";
    default: return null;
  }
}

export function workspaceActivity(sessions: ActivitySession[], workspaceId: string) {
  const rows = sessions.filter((s) => s.workspaceId === workspaceId);
  if (rows.some((s) => s.pending > 0 || s.status === "awaiting")) return "Needs attention";
  if (rows.some((s) => s.status === "error")) return "Session error";
  if (rows.some((s) => s.status === "running" || s.status === "starting")) return "Running";
  return null;
}

export function summarizeUsage(entries: UsageEntry[], workspaceBySession: Map<string, string>, timeZone: string): UsageSummary {
  const days = new Map<string, number>();
  const workspaces = new Map<string, number>();
  const seen = new Set<string>();
  let total = 0;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  for (const entry of entries) {
    const key = `${entry.sessionId}:${entry.seq}`;
    if (seen.has(key) || !Number.isFinite(entry.costUsd) || entry.costUsd < 0) continue;
    seen.add(key);
    total += entry.costUsd;
    const day = formatter.format(new Date(entry.ts));
    days.set(day, (days.get(day) ?? 0) + entry.costUsd);
    const workspace = workspaceBySession.get(entry.sessionId);
    if (workspace) workspaces.set(workspace, (workspaces.get(workspace) ?? 0) + entry.costUsd);
  }
  return {
    total,
    days: [...days].map(([name, cost]) => ({ name, cost })).sort((a, b) => b.name.localeCompare(a.name)),
    workspaces: [...workspaces].map(([id, cost]) => ({ id, cost })).sort((a, b) => b.cost - a.cost),
  };
}
