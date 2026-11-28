import type { DelegateInput, DelegationPlanInput, WorkerMode } from "./schema";

/** A delegation waiting for a free slot or for the tasks it depends on. */
export type QueuedDelegation = { taskId: string; chiefSessionId: string | null; input: DelegateInput; dependsOn: string[]; queuedAt: string };
/** What delegation cost and how often it needed another round, per task. */
export type TaskStats = {
  taskId: string; title: string; models: string[]; mode: WorkerMode;
  startedAt: string; finishedAt: string | null; durationMs: number;
  costUsd: number; rounds: number; outcome: string | null;
  /** `${sessionId}:${seq}` of each counted finish, so a recovered report is not counted twice. */
  counted: string[];
};
export type RaceEntry = { sessionId: string; workspaceId: string; model: string };
export type Race = { id: string; taskId: string; entries: RaceEntry[]; winner: string | null; createdAt: string };
export type PlanStatus = "pending" | "approved" | "rejected";
export type DelegationPlan = DelegationPlanInput & {
  id: string; chiefSessionId: string; status: PlanStatus; createdAt: string; decidedAt: string | null;
  note: string | null; taskIds: Record<string, string>;
};
// The queue, races, stats and relay ledger live in Postgres: lib/db/repo/worker-state.ts.
// Plans and integrations: lib/db/repo/delegation-plans.ts and integrations.ts.

/** Per-model history: how much a task costs and how often it is accepted after one round. */
export function summarizeStats(stats: TaskStats[]) {
  const byModel = new Map<string, TaskStats[]>();
  for (const s of stats) for (const model of s.models) byModel.set(model, [...(byModel.get(model) ?? []), s]);
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return [...byModel].map(([model, rows]) => {
    const finished = rows.filter((r) => r.rounds > 0);
    return {
      model, tasks: rows.length,
      avgCostUsd: round(finished.reduce((n, r) => n + r.costUsd, 0) / (finished.length || 1)),
      avgRounds: round(finished.reduce((n, r) => n + r.rounds, 0) / (finished.length || 1)),
      avgMinutes: round(finished.reduce((n, r) => n + r.durationMs, 0) / (finished.length || 1) / 60_000),
      firstRoundDone: finished.filter((r) => r.rounds === 1 && r.outcome === "done").length,
      totalCostUsd: round(rows.reduce((n, r) => n + r.costUsd, 0)),
    };
  }).sort((a, b) => b.tasks - a.tasks);
}
