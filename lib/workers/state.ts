import "server-only";
import path from "node:path";
import { readOptional, replaceFile, withFileLock } from "@/lib/notes/file-write";
import { projectConfigDir } from "@/lib/projects/paths";
import type { Project } from "@/lib/projects/types";
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
/** The project's current integration worktree; older ones are archived when a new one is made. */
export type Integration = { workspaceId: string; taskIds: string[]; createdAt: string };
export type WorkerState = { queue: QueuedDelegation[]; stats: Record<string, TaskStats>; races: Record<string, Race>; plans: Record<string, DelegationPlan>; integrations: Integration[] };

const empty = (): WorkerState => ({ queue: [], stats: {}, races: {}, plans: {}, integrations: [] });
export const stateFile = (project: Pick<Project, "dataKey">) => path.join(projectConfigDir(project.dataKey), "workers", "state.json");

export async function readWorkerState(project: Pick<Project, "dataKey">): Promise<WorkerState> {
  const text = await readOptional(stateFile(project));
  return text ? { ...empty(), ...JSON.parse(text) } : empty();
}

/** Read, change and write the project's worker state under one lock. The mutator's return value is passed through. */
export async function updateWorkerState<T>(project: Pick<Project, "dataKey">, mutate: (state: WorkerState) => T | Promise<T>): Promise<T> {
  const file = stateFile(project);
  return withFileLock(file, async () => {
    const previous = await readOptional(file);
    const state: WorkerState = previous ? { ...empty(), ...JSON.parse(previous) } : empty();
    const result = await mutate(state);
    const next = JSON.stringify(state);
    if (next !== previous) await replaceFile(file, next, previous);
    return result;
  });
}

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
