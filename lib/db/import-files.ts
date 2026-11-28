import "server-only";
import { listProjects } from "@/lib/db/repo/projects";
import { insertPlanRows } from "@/lib/db/repo/delegation-plans";
import { insertIntegrationRow } from "@/lib/db/repo/integrations";
import type { Project } from "@/lib/projects/types";
import type { DelegationPlan } from "@/lib/workers/state";
import { stateFile, updateWorkerState } from "@/lib/workers/state";
import { readOptional } from "@/lib/notes/file-write";
import { db, type Db } from "./server";
import { transaction } from "./sql";

type LegacyIntegration = { workspaceId: string; taskIds: string[]; createdAt: string };
type LegacyWorkerState = { plans?: Record<string, DelegationPlan>; integrations?: LegacyIntegration[] };

/** Plans and the current integration from a project's `config/workers/state.json`. Rows that already exist are skipped. */
async function importWorkerPlans(tx: Db, project: Pick<Project, "id">, state: LegacyWorkerState) {
  for (const plan of Object.values(state.plans ?? {})) await insertPlanRows(tx, project.id, { ...plan, taskIds: plan.taskIds ?? {} });
  for (const i of state.integrations ?? []) {
    const [exists] = await tx.query("select 1 from integrations where project_id = $1 and workspace_id = $2", [project.id, i.workspaceId]);
    if (!exists) await insertIntegrationRow(tx, { projectId: project.id, workspaceId: i.workspaceId, branch: null, taskIds: i.taskIds, createdAt: i.createdAt, merged: null, conflicts: null, tests: null, headShas: null });
  }
}

/**
 * Move orchestration state that older versions kept in files into Postgres, once, at startup.
 * Each file is imported in one transaction and only changed after it commits, so a crash
 * part-way leaves the file to be imported again; every insert skips rows that already exist.
 * Memory-only mode leaves the files alone: rows there would not survive a restart.
 */
export async function importStateFiles() {
  const client = db();
  if (!client) return;
  for (const project of await listProjects({ includeHome: true })) {
    try {
      if (!await readOptional(stateFile(project))) continue;
      await updateWorkerState(project, async (state) => {
        const legacy = state as typeof state & LegacyWorkerState;
        if (!legacy.plans && !legacy.integrations) return;
        await transaction(client, (tx) => importWorkerPlans(tx, project, legacy));
        delete legacy.plans;
        delete legacy.integrations;
      });
    } catch (error) {
      console.error(`[thunk] importing worker state for ${project.name} failed; it stays in its file`, error);
    }
  }
}
