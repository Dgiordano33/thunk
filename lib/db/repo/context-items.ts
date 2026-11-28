import "server-only";
import type { ContextKind, ContextMode, ContextOrigin, SessionContextItem } from "@/lib/context/types";
import { db, type Db } from "../server";

/** A row to write: everything but the ids and timestamps the table fills. */
export type ContextItemRow = {
  kind: ContextKind;
  refId: string;
  title: string;
  path: string | null;
  mode: ContextMode;
  reason: string | null;
  chars: number;
  contentHash: string | null;
  content: string | null;
};

type Stored = SessionContextItem & { content: string | null };

// Memory-only mode keeps items for the server's lifetime, like documents. Pinned to globalThis for HMR.
const g = globalThis as typeof globalThis & { __thunkMemContext?: Map<string, Stored[]> };
const mem: Map<string, Stored[]> = (g.__thunkMemContext ??= new Map());

const COLUMNS = "id, session_id, kind, ref_id, title, path, mode, reason, chars, content_hash, content, origin, removed_at, created_at, updated_at";

type DbRow = {
  id: string; session_id: string; kind: ContextKind; ref_id: string; title: string; path: string | null; mode: ContextMode; reason: string | null;
  chars: number; content_hash: string | null; content: string | null; origin: ContextOrigin; removed_at: string | null; created_at: string; updated_at: string;
};

const fromRow = (r: DbRow): Stored => ({
  id: r.id, sessionId: r.session_id, kind: r.kind, refId: r.ref_id, title: r.title, path: r.path, mode: r.mode, reason: r.reason,
  chars: Number(r.chars), contentHash: r.content_hash, content: r.content, origin: r.origin, removedAt: r.removed_at, createdAt: r.created_at, updatedAt: r.updated_at,
});

const INSERT_COLUMNS = ["session_id", "origin", "kind", "ref_id", "title", "path", "mode", "reason", "chars", "content_hash", "content"];
const values = (sessionId: string, origin: ContextOrigin, i: ContextItemRow) =>
  [sessionId, origin, i.kind, i.refId, i.title, i.path, i.mode, i.reason, i.chars, i.contentHash, i.content];

/** Plain insert (insertSql would send `origin` as JSON: it is a jsonb column elsewhere). */
function insertItems(client: Db, sessionId: string, origin: ContextOrigin, items: ContextItemRow[], conflict: string) {
  const params: unknown[] = [];
  const rows = items.map((item) => `(${values(sessionId, origin, item).map((v) => (params.push(v), `$${params.length}`)).join(", ")})`);
  return client.query(`insert into session_context_items (${INSERT_COLUMNS.join(", ")}) values ${rows.join(", ")} on conflict (session_id, origin, kind, ref_id) ${conflict}`, params);
}

function memItem(sessionId: string, origin: ContextOrigin, i: ContextItemRow): Stored {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), sessionId, origin, ...i, removedAt: null, createdAt: now, updatedAt: now };
}

/**
 * Replace a session's prompt items with a freshly built set. Removed items stay (they hold the
 * removal); the builders leave them out, so they never collide with the new set.
 */
export async function replacePromptItems(sessionId: string, items: ContextItemRow[]) {
  const client = db();
  if (!client) {
    const kept = (mem.get(sessionId) ?? []).filter((i) => i.origin !== "prompt" || i.removedAt);
    const taken = new Set(kept.filter((i) => i.origin === "prompt").map((i) => `${i.kind}:${i.refId}`));
    mem.set(sessionId, [...kept, ...items.filter((i) => !taken.has(`${i.kind}:${i.refId}`)).map((i) => memItem(sessionId, "prompt", i))]);
    return;
  }
  await client.query("delete from session_context_items where session_id = $1 and origin = 'prompt' and removed_at is null", [sessionId]);
  for (let i = 0; i < items.length; i += 200)
    await insertItems(client, sessionId, "prompt", items.slice(i, i + 200), "do nothing");
}

/** Add or refresh one fetched or attached item (a second read of the same file updates it). */
export async function upsertContextItem(sessionId: string, origin: Exclude<ContextOrigin, "prompt">, item: ContextItemRow) {
  const client = db();
  if (!client) {
    const list = mem.get(sessionId) ?? [];
    const at = list.findIndex((i) => i.origin === origin && i.kind === item.kind && i.refId === item.refId);
    if (at >= 0) list[at] = { ...list[at], ...item, updatedAt: new Date().toISOString() };
    else list.push(memItem(sessionId, origin, item));
    mem.set(sessionId, list);
    return;
  }
  await insertItems(client, sessionId, origin, [item], `do update set ${INSERT_COLUMNS.slice(4).map((c) => `${c} = excluded.${c}`).join(", ")}, updated_at = now()`);
}

export async function listContextItems(sessionId: string): Promise<Stored[]> {
  const client = db();
  if (!client) return [...(mem.get(sessionId) ?? [])];
  const rows = await client.query<DbRow>(`select ${COLUMNS} from session_context_items where session_id = $1 order by created_at, title`, [sessionId]);
  return rows.map(fromRow);
}

export async function getContextItem(sessionId: string, id: string): Promise<Stored | null> {
  return (await listContextItems(sessionId)).find((i) => i.id === id) ?? null;
}

/** Items of this kind whose file is at `path`, across sessions (the note editor's per-session state). */
export async function contextItemsForPath(path: string): Promise<Stored[]> {
  const client = db();
  if (!client) return [...mem.values()].flat().filter((i) => i.path === path);
  return (await client.query<DbRow>(`select ${COLUMNS} from session_context_items where path = $1`, [path])).map(fromRow);
}

/** Keys (`kind:refId`) of prompt items the person removed; the builders leave them out. */
export async function removedContextKeys(sessionId: string): Promise<Set<string>> {
  const items = await listContextItems(sessionId);
  return new Set(items.filter((i) => i.origin === "prompt" && i.removedAt).map((i) => `${i.kind}:${i.refId}`));
}

export async function setContextItemRemoved(sessionId: string, id: string, removed: boolean) {
  const client = db();
  const removedAt = removed ? new Date().toISOString() : null;
  if (!client) {
    const item = (mem.get(sessionId) ?? []).find((i) => i.id === id);
    if (item) Object.assign(item, { removedAt, updatedAt: new Date().toISOString() });
    return;
  }
  // The database's clock, like created_at, so "removed after the last prompt build" compares like with like.
  await client.query("update session_context_items set removed_at = case when $1::boolean then now() else null end, updated_at = now() where session_id = $2 and id = $3", [removed, sessionId, id]);
}

/** After Send update: the session now holds this version. */
export async function markContextItemSent(sessionId: string, id: string, patch: { contentHash: string; content: string | null; chars: number }) {
  const client = db();
  if (!client) {
    const item = (mem.get(sessionId) ?? []).find((i) => i.id === id);
    if (item) Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    return;
  }
  await client.query("update session_context_items set content_hash = $1, content = $2, chars = $3, updated_at = now() where session_id = $4 and id = $5", [patch.contentHash, patch.content, patch.chars, sessionId, id]);
}
