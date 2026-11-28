import "server-only";
import { rename } from "node:fs/promises";
import path from "node:path";
import { listProjects } from "@/lib/db/repo/projects";
import { insertPlanRows } from "@/lib/db/repo/delegation-plans";
import { insertIntegrationRow } from "@/lib/db/repo/integrations";
import { insertQueueRow, insertRaceRow, insertRelayRow, insertStatsRow } from "@/lib/db/repo/worker-state";
import { readOptional } from "@/lib/notes/file-write";
import { projectConfigDir } from "@/lib/projects/paths";
import type { Project } from "@/lib/projects/types";
import type { DelegationPlan, QueuedDelegation, Race, TaskStats } from "@/lib/workers/state";
import { db, type Db } from "./server";
import { transaction } from "./sql";

/** What older versions kept in `config/workers/state.json`. Any field may be missing. */
type LegacyWorkerState = {
  plans?: Record<string, DelegationPlan>;
  integrations?: { workspaceId: string; taskIds: string[]; createdAt: string }[];
  queue?: QueuedDelegation[];
  races?: Record<string, Race>;
  stats?: Record<string, TaskStats>;
  relayTasks?: Record<string, Record<string, string>>;
};

export const workerStateFile = (project: Pick<Project, "dataKey">) => path.join(projectConfigDir(project.dataKey), "workers", "state.json");

/** Every field of a project's worker state file. Rows that already exist are skipped. */
async function importWorkerState(tx: Db, projectId: string, state: LegacyWorkerState) {
  for (const plan of Object.values(state.plans ?? {})) await insertPlanRows(tx, projectId, { ...plan, taskIds: plan.taskIds ?? {} });
  for (const i of state.integrations ?? []) {
    const [exists] = await tx.query("select 1 from integrations where project_id = $1 and workspace_id = $2", [projectId, i.workspaceId]);
    if (!exists) await insertIntegrationRow(tx, { projectId, workspaceId: i.workspaceId, branch: null, taskIds: i.taskIds, createdAt: i.createdAt, merged: null, conflicts: null, tests: null, headShas: null });
  }
  // In file order, so the queue keeps its order.
  for (const item of state.queue ?? []) await insertQueueRow(tx, projectId, { ...item, dependsOn: item.dependsOn ?? [] });
  for (const race of Object.values(state.races ?? {})) await insertRaceRow(tx, projectId, race);
  for (const stats of Object.values(state.stats ?? {})) await insertStatsRow(tx, projectId, { ...stats, counted: stats.counted ?? [] });
  for (const [relayId, ledger] of Object.entries(state.relayTasks ?? {})) {
    for (const [key, taskId] of Object.entries(ledger)) await insertRelayRow(tx, projectId, relayId, key, taskId);
  }
}

/** Import one JSON file in one transaction, then rename it to `<file>.imported`. */
async function importFile(client: Db, file: string, load: (tx: Db, value: never) => Promise<void>) {
  const text = await readOptional(file);
  if (text === null) return false;
  await transaction(client, (tx) => load(tx, JSON.parse(text) as never));
  await rename(file, `${file}.imported`);
  return true;
}

/**
 * Move orchestration state that older versions kept in files into Postgres, once, at startup.
 * Each file is imported in one transaction and renamed only after it commits, so a crash part-way
 * leaves the file to be imported again; every insert skips rows that already exist.
 * Memory-only mode leaves the files alone: rows there would not survive a restart.
 */
export async function importStateFiles() {
  const client = db();
  if (!client) return;
  for (const project of await listProjects({ includeHome: true })) {
    const file = workerStateFile(project);
    try {
      if (await importFile(client, file, (tx, state: LegacyWorkerState) => importWorkerState(tx, project.id, state))) console.log(`[thunk] imported ${file}`);
    } catch (error) {
      console.error(`[thunk] importing ${file} failed; it stays in place and is retried on the next start`, error);
    }
  }
}
