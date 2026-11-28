import "server-only";
import type { PlanChange, PlanChangeItem, PlanChangeStatus, SourceKind, TaskSource } from "@/lib/sources/types";
import { db } from "../server";

// Task sources (what a task was delegated from) and plan changes (a revision of a source and the chief's proposal).
// Memory-only mode keeps the same shapes on globalThis.

type SourceRow = { task_id: string; source_kind: SourceKind; source_id: string; version: number; delivered_version: number; content_hash: string | null; content: string | null };
const toSource = (r: SourceRow): TaskSource => ({ taskId: r.task_id, kind: r.source_kind, sourceId: r.source_id, version: r.version, deliveredVersion: r.delivered_version, contentHash: r.content_hash, content: r.content });
type ChangeRow = {
  id: string; project_id: string; source_kind: SourceKind; source_id: string; source_title: string; version: number; diff: string; chief_session_id: string | null;
  status: PlanChangeStatus; items: PlanChangeItem[]; created_at: string; updated_at: string; resolved_at: string | null;
};
const toChange = (r: ChangeRow): PlanChange => ({
  id: r.id, projectId: r.project_id, kind: r.source_kind, sourceId: r.source_id, sourceTitle: r.source_title, version: r.version, diff: r.diff,
  chiefSessionId: r.chief_session_id, status: r.status, items: r.items ?? [], createdAt: r.created_at, updatedAt: r.updated_at, resolvedAt: r.resolved_at,
});

const g = globalThis as typeof globalThis & { __thunkMemSources?: { sources: TaskSource[]; changes: Map<string, PlanChange> } };
const mem: { sources: TaskSource[]; changes: Map<string, PlanChange> } = (g.__thunkMemSources ??= { sources: [], changes: new Map() });
const same = (a: Pick<TaskSource, "taskId" | "kind" | "sourceId">, b: Pick<TaskSource, "taskId" | "kind" | "sourceId">) => a.taskId === b.taskId && a.kind === b.kind && a.sourceId === b.sourceId;

/** Link a task to a source. A link that already exists keeps its versions (re-delegating does not reset them). */
export async function linkTaskSource(source: Omit<TaskSource, "version" | "deliveredVersion">): Promise<TaskSource> {
  const client = db();
  if (!client) {
    const existing = mem.sources.find((s) => same(s, source));
    if (existing) return structuredClone(existing);
    const row = { ...source, version: 1, deliveredVersion: 1 };
    mem.sources.push(row);
    return structuredClone(row);
  }
  await client.query(
    `insert into task_sources (task_id, source_kind, source_id, content_hash, content) values ($1, $2, $3, $4, $5)
     on conflict (task_id, source_kind, source_id) do nothing`,
    [source.taskId, source.kind, source.sourceId, source.contentHash, source.content],
  );
  const [row] = await client.query<SourceRow>("select * from task_sources where task_id = $1 and source_kind = $2 and source_id = $3", [source.taskId, source.kind, source.sourceId]);
  return toSource(row);
}

/** A task's sources, documents first. */
export async function listTaskSources(taskId: string): Promise<TaskSource[]> {
  const client = db();
  const order = (a: TaskSource, b: TaskSource) => (a.kind === b.kind ? 0 : a.kind === "document" ? -1 : 1);
  if (!client) return structuredClone(mem.sources.filter((s) => s.taskId === taskId)).sort(order);
  return (await client.query<SourceRow>("select * from task_sources where task_id = $1 order by created_at", [taskId])).map(toSource).sort(order);
}

/** Every task linked to any of these source ids. */
export async function tasksForSources(kind: SourceKind, sourceIds: string[]): Promise<TaskSource[]> {
  if (!sourceIds.length) return [];
  const client = db();
  if (!client) return structuredClone(mem.sources.filter((s) => s.kind === kind && sourceIds.includes(s.sourceId)));
  return (await client.query<SourceRow>("select * from task_sources where source_kind = $1 and source_id = any($2::text[])", [kind, sourceIds])).map(toSource);
}

/** Record a new revision for these links: version goes up by one, and the new text becomes the base for the next diff. */
export async function reviseTaskSources(links: Pick<TaskSource, "taskId" | "kind" | "sourceId">[], content: string, contentHash: string): Promise<TaskSource[]> {
  if (!links.length) return [];
  const client = db();
  if (!client) {
    const out: TaskSource[] = [];
    for (const link of links) {
      const row = mem.sources.find((s) => same(s, link));
      if (!row) continue;
      Object.assign(row, { version: row.version + 1, content, contentHash });
      out.push(structuredClone(row));
    }
    return out;
  }
  return (await client.query<SourceRow>(
    `update task_sources t set version = t.version + 1, content = $2, content_hash = $3, updated_at = now()
     from jsonb_to_recordset($1::jsonb) as l(task_id uuid, source_kind text, source_id text)
     where t.task_id = l.task_id and t.source_kind = l.source_kind and t.source_id = l.source_id returning t.*`,
    [JSON.stringify(links.map((l) => ({ task_id: l.taskId, source_kind: l.kind, source_id: l.sourceId }))), content, contentHash],
  )).map(toSource);
}

/** The worker now has this version of the source. Never moves backwards. */
export async function setDeliveredVersion(link: Pick<TaskSource, "taskId" | "kind" | "sourceId">, version: number) {
  const client = db();
  if (!client) {
    const row = mem.sources.find((s) => same(s, link));
    if (row) row.deliveredVersion = Math.max(row.deliveredVersion, version);
    return;
  }
  await client.query(
    "update task_sources set delivered_version = greatest(delivered_version, $4), updated_at = now() where task_id = $1 and source_kind = $2 and source_id = $3",
    [link.taskId, link.kind, link.sourceId, version],
  );
}

// ---------- plan changes ----------

export async function insertPlanChange(change: Omit<PlanChange, "id" | "createdAt" | "updatedAt" | "resolvedAt" | "status"> & { status?: PlanChangeStatus }): Promise<PlanChange> {
  const now = new Date().toISOString();
  const client = db();
  if (!client) {
    const row: PlanChange = { ...structuredClone(change), status: change.status ?? "waiting", id: crypto.randomUUID(), createdAt: now, updatedAt: now, resolvedAt: null };
    mem.changes.set(row.id, row);
    return structuredClone(row);
  }
  const [row] = await client.query<ChangeRow>(
    `insert into plan_changes (project_id, source_kind, source_id, source_title, version, diff, chief_session_id, status, items)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) returning *`,
    [change.projectId, change.kind, change.sourceId, change.sourceTitle, change.version, change.diff, change.chiefSessionId, change.status ?? "waiting", JSON.stringify(change.items)],
  );
  return toChange(row);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function getPlanChange(id: string): Promise<PlanChange | null> {
  const client = db();
  if (!client) { const row = mem.changes.get(id); return row ? structuredClone(row) : null; }
  if (!UUID.test(id)) return null;
  const [row] = await client.query<ChangeRow>("select * from plan_changes where id = $1", [id]);
  return row ? toChange(row) : null;
}

/**
 * Update a change only while it is in one of `from`, so two servers (or two clicks) cannot both apply it.
 * Null when it had moved on.
 */
export async function updatePlanChange(id: string, from: PlanChangeStatus[], patch: { status?: PlanChangeStatus; items?: PlanChangeItem[] }): Promise<PlanChange | null> {
  const resolved = patch.status === "applied" || patch.status === "dismissed" ? new Date().toISOString() : null;
  const client = db();
  if (!client) {
    const row = mem.changes.get(id);
    if (!row || !from.includes(row.status)) return null;
    Object.assign(row, { ...(patch.status ? { status: patch.status } : {}), ...(patch.items ? { items: structuredClone(patch.items) } : {}), updatedAt: new Date().toISOString(), ...(resolved ? { resolvedAt: resolved } : {}) });
    return structuredClone(row);
  }
  const [row] = await client.query<ChangeRow>(
    `update plan_changes set status = coalesce($3, status), items = coalesce($4::jsonb, items), updated_at = now(), resolved_at = coalesce($5::timestamptz, resolved_at)
     where id = $1 and status = any($2::text[]) returning *`,
    [id, from, patch.status ?? null, patch.items ? JSON.stringify(patch.items) : null, resolved],
  );
  return row ? toChange(row) : null;
}
