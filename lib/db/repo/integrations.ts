import "server-only";
import type { IntegrationResult } from "@/lib/workers/integrate";
import { db, type Db } from "../server";
import { lockKey, transaction } from "../sql";

export type HeadSha = { taskId: string; repo: string; branch: string; sha: string | null };
/** One trial merge. Imported ones from before this table have no details (null). */
export type Integration = {
  id: string; projectId: string; workspaceId: string; branch: string | null; taskIds: string[];
  createdAt: string; replacedAt: string | null;
  merged: IntegrationResult["merged"] | null; conflicts: IntegrationResult["conflicts"] | null;
  tests: IntegrationResult["tests"] | null; headShas: HeadSha[] | null;
};
export type NewIntegration = Omit<Integration, "id" | "createdAt" | "replacedAt"> & { createdAt?: string };

type Row = { id: string; project_id: string; workspace_id: string; branch: string | null; created_at: string; replaced_at: string | null; merged: Integration["merged"]; conflicts: Integration["conflicts"]; tests: Integration["tests"]; head_shas: HeadSha[] | null; task_ids: string[] };

const g = globalThis as typeof globalThis & { __thunkMemIntegrations?: Integration[] };
const mem = (g.__thunkMemIntegrations ??= []);
const SELECT = `select i.*, coalesce((select json_agg(t.task_id order by t.position) from integration_tasks t where t.integration_id = i.id), '[]'::json) as task_ids from integrations i`;
const toIntegration = (r: Row): Integration => ({
  id: r.id, projectId: r.project_id, workspaceId: r.workspace_id, branch: r.branch, taskIds: r.task_ids, createdAt: r.created_at, replacedAt: r.replaced_at,
  merged: r.merged, conflicts: r.conflicts, tests: r.tests, headShas: r.head_shas,
});
const json = (v: unknown) => v === null || v === undefined ? null : JSON.stringify(v);

/** Insert one integration row and its tasks. */
export async function insertIntegrationRow(tx: Db, input: NewIntegration & { replacedAt?: string | null }) {
  const [row] = await tx.query<{ id: string }>(
    `insert into integrations (project_id, workspace_id, branch, created_at, replaced_at, merged, conflicts, tests, head_shas)
     values ($1, $2, $3, coalesce($4::timestamptz, now()), $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb) returning id`,
    [input.projectId, input.workspaceId, input.branch, input.createdAt ?? null, input.replacedAt ?? null, json(input.merged), json(input.conflicts), json(input.tests), json(input.headShas)],
  );
  for (const [position, taskId] of [...new Set(input.taskIds)].entries()) {
    await tx.query("insert into integration_tasks (integration_id, task_id, position) values ($1, $2, $3)", [row.id, taskId, position]);
  }
  return row.id;
}

/**
 * Store a trial merge as the project's current one. Earlier current ones are marked replaced in the
 * same transaction and returned, so the caller can archive their workspaces.
 */
export async function recordIntegration(input: NewIntegration): Promise<{ id: string; replaced: Integration[] }> {
  const client = db();
  const now = new Date().toISOString();
  if (!client) {
    const replaced = mem.filter((i) => i.projectId === input.projectId && !i.replacedAt && i.workspaceId !== input.workspaceId);
    for (const i of replaced) i.replacedAt = now;
    const row: Integration = { ...input, taskIds: [...new Set(input.taskIds)], id: crypto.randomUUID(), createdAt: input.createdAt ?? now, replacedAt: null };
    mem.push(row);
    return { id: row.id, replaced: structuredClone(replaced) };
  }
  return transaction(client, async (tx) => {
    // Two trial merges finishing at once must not both stay current.
    await lockKey(tx, `integrations:${input.projectId}`);
    const replaced = await tx.query<Row>(
      `update integrations i set replaced_at = $3 where project_id = $1 and replaced_at is null and workspace_id <> $2
       returning i.*, coalesce((select json_agg(t.task_id order by t.position) from integration_tasks t where t.integration_id = i.id), '[]'::json) as task_ids`,
      [input.projectId, input.workspaceId, now],
    );
    const id = await insertIntegrationRow(tx, input);
    return { id, replaced: replaced.map(toIntegration) };
  });
}

/** The project's current trial merges (normally one), newest first. */
export async function currentIntegrations(projectId: string): Promise<Integration[]> {
  const client = db();
  if (!client) return structuredClone(mem.filter((i) => i.projectId === projectId && !i.replacedAt).reverse());
  return (await client.query<Row>(`${SELECT} where i.project_id = $1 and i.replaced_at is null order by i.created_at desc`, [projectId])).map(toIntegration);
}

/** The newest trial merge that included this task, current or replaced; null if it was never integrated. */
export async function latestIntegrationForTask(taskId: string): Promise<Integration | null> {
  const client = db();
  if (!client) {
    const row = mem.findLast((i) => i.taskIds.includes(taskId));
    return row ? structuredClone(row) : null;
  }
  const [row] = await client.query<Row>(
    `${SELECT} where exists (select 1 from integration_tasks t where t.integration_id = i.id and t.task_id = $1) order by i.created_at desc limit 1`,
    [taskId],
  );
  return row ? toIntegration(row) : null;
}
