import "server-only";
import type { ContextNoteRef, ContextSet } from "@/lib/context/types";
import type { ContextSetInput, ContextSetPatch } from "@/lib/context/schema";
import { db } from "../server";

// Memory-only mode keeps sets for the server's lifetime. Pinned to globalThis for HMR.
const g = globalThis as typeof globalThis & { __thunkMemContextSets?: Map<string, ContextSet> };
const mem: Map<string, ContextSet> = (g.__thunkMemContextSets ??= new Map());

type Row = { id: string; project_id: string; name: string; notes: unknown; task_ids: unknown; vault_ids: unknown; created_at: string; updated_at: string };
const COLUMNS = "id, project_id, name, notes, task_ids, vault_ids, created_at, updated_at";
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const fromRow = (r: Row): ContextSet => ({
  id: r.id, projectId: r.project_id, name: r.name,
  notes: list<ContextNoteRef>(r.notes), taskIds: list<string>(r.task_ids), vaultIds: list<string>(r.vault_ids),
  createdAt: r.created_at, updatedAt: r.updated_at,
});

/** Sets with this name in the project already exist: names are unique per project. */
export class ContextSetNameTaken extends Error {}

const unique = (err: unknown): never => {
  if ((err as { code?: string }).code === "23505") throw new ContextSetNameTaken("A context set with that name already exists");
  throw err;
};

export async function listContextSets(projectId: string): Promise<ContextSet[]> {
  const client = db();
  if (!client) return [...mem.values()].filter((s) => s.projectId === projectId).sort((a, b) => a.name.localeCompare(b.name));
  return (await client.query<Row>(`select ${COLUMNS} from context_sets where project_id = $1 order by lower(name)`, [projectId])).map(fromRow);
}

export async function getContextSet(id: string): Promise<ContextSet | null> {
  const client = db();
  if (!client) return mem.get(id) ?? null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await client.query<Row>(`select ${COLUMNS} from context_sets where id = $1`, [id]);
  return row ? fromRow(row) : null;
}

export async function insertContextSet(projectId: string, input: ContextSetInput): Promise<ContextSet> {
  const client = db();
  if (!client) {
    if ([...mem.values()].some((s) => s.projectId === projectId && s.name === input.name)) throw new ContextSetNameTaken("A context set with that name already exists");
    const now = new Date().toISOString();
    const set: ContextSet = { id: crypto.randomUUID(), projectId, name: input.name, notes: input.notes, taskIds: input.taskIds, vaultIds: input.vaultIds, createdAt: now, updatedAt: now };
    mem.set(set.id, set);
    return set;
  }
  const [row] = await client.query<Row>(
    `insert into context_sets (project_id, name, notes, task_ids, vault_ids) values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb) returning ${COLUMNS}`,
    [projectId, input.name, JSON.stringify(input.notes), JSON.stringify(input.taskIds), JSON.stringify(input.vaultIds)],
  ).catch(unique);
  return fromRow(row);
}

export async function updateContextSet(id: string, patch: ContextSetPatch): Promise<ContextSet | null> {
  const current = await getContextSet(id);
  if (!current) return null;
  const next = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as ContextSet;
  const client = db();
  if (!client) {
    if ([...mem.values()].some((s) => s.id !== id && s.projectId === next.projectId && s.name === next.name)) throw new ContextSetNameTaken("A context set with that name already exists");
    mem.set(id, { ...next, updatedAt: new Date().toISOString() });
    return mem.get(id)!;
  }
  const [row] = await client.query<Row>(
    `update context_sets set name = $1, notes = $2::jsonb, task_ids = $3::jsonb, vault_ids = $4::jsonb, updated_at = now() where id = $5 returning ${COLUMNS}`,
    [next.name, JSON.stringify(next.notes), JSON.stringify(next.taskIds), JSON.stringify(next.vaultIds), id],
  ).catch(unique);
  return row ? fromRow(row) : null;
}

export async function deleteContextSet(id: string): Promise<boolean> {
  const client = db();
  if (!client) return mem.delete(id);
  return (await client.query("delete from context_sets where id = $1 returning id", [id])).length > 0;
}
