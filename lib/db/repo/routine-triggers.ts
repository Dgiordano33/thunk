import "server-only";
import type { Routine, RunTrigger } from "@/lib/routines/types";
import { db } from "../server";
import { updateRoutine } from "./routines";

export type TriggerStatus = "pending" | "started" | "skipped" | "failed";

/** One firing of a routine, waiting for (or past) its run. See db/migrations/…_0027_routine_triggers.sql. */
export type RoutineTrigger = {
  id: string;
  routineId: string;
  source: RunTrigger;
  dedupeKey: string;
  payload: Record<string, unknown> | null;
  status: TriggerStatus;
  attempts: number;
  nextAttemptAt: string;
  runId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewTrigger = { source: RunTrigger; dedupeKey: string; payload?: Record<string, unknown> | null };
/** The poller's cursor, written together with the triggers it produced. */
export type TriggerCursor = Partial<Pick<Routine, "nextRunAt" | "triggerState">>;
type TriggerPatch = Partial<Pick<RoutineTrigger, "status" | "attempts" | "nextAttemptAt" | "runId" | "error">>;

type Row = {
  id: string;
  routine_id: string;
  source: string;
  dedupe_key: string;
  payload: Record<string, unknown> | null;
  status: string;
  attempts: number;
  next_attempt_at: string;
  run_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS = "id, routine_id, source, dedupe_key, payload, status, attempts, next_attempt_at, run_id, error, created_at, updated_at";

const toTrigger = (r: Row): RoutineTrigger => ({
  id: r.id,
  routineId: r.routine_id,
  source: r.source as RunTrigger,
  dedupeKey: r.dedupe_key,
  payload: r.payload ?? null,
  status: r.status as TriggerStatus,
  attempts: Number(r.attempts),
  nextAttemptAt: r.next_attempt_at,
  runId: r.run_id,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// Memory-only mode: lives for the server's lifetime, like the routines themselves. Pinned to globalThis for HMR.
const g = globalThis as typeof globalThis & { __thunkMemRoutineTriggers?: Map<string, RoutineTrigger> };
const mem = (g.__thunkMemRoutineTriggers ??= new Map());

/**
 * Record firings and move the routine's cursor past them in one statement, so a crash leaves either both
 * or neither. Keys already present are skipped, which makes a repeated poll harmless. Returns how many
 * triggers were new.
 */
export async function enqueueTriggers(routineId: string, triggers: NewTrigger[], cursor?: TriggerCursor): Promise<number> {
  const client = db();
  if (!client) {
    const now = new Date().toISOString();
    const keys = new Set([...mem.values()].map((t) => t.dedupeKey));
    let inserted = 0;
    for (const t of triggers) {
      if (keys.has(t.dedupeKey)) continue;
      keys.add(t.dedupeKey);
      const row: RoutineTrigger = {
        id: crypto.randomUUID(), routineId, source: t.source, dedupeKey: t.dedupeKey, payload: t.payload ?? null, status: "pending",
        attempts: 0, nextAttemptAt: now, runId: null, error: null, createdAt: now, updatedAt: now,
      };
      mem.set(row.id, row);
      inserted++;
    }
    if (cursor && Object.keys(cursor).length) await updateRoutine(routineId, cursor);
    return inserted;
  }
  const rows = JSON.stringify(triggers.map((t) => ({ source: t.source, dedupe_key: t.dedupeKey, payload: t.payload ?? null })));
  const insert = `insert into routine_triggers (routine_id, source, dedupe_key, payload)
      select $1, t.source, t.dedupe_key, t.payload from jsonb_to_recordset($2::jsonb) as t(source text, dedupe_key text, payload jsonb)
      on conflict (dedupe_key) do nothing returning id`;
  if (!cursor || !Object.keys(cursor).length) {
    const [{ inserted }] = await client.query<{ inserted: number }>(`with ins as (${insert}) select count(*)::int as inserted from ins`, [routineId, rows]);
    return inserted;
  }
  const [{ inserted }] = await client.query<{ inserted: number }>(
    `with ins as (${insert}),
     upd as (
       update routines set
         next_run_at = case when $3::boolean then $4::timestamptz else next_run_at end,
         trigger_state = coalesce($5::jsonb, trigger_state)
       where id = $1 returning id
     )
     select (select count(*)::int from ins) as inserted, (select count(*)::int from upd) as updated`,
    [routineId, rows, "nextRunAt" in cursor, cursor.nextRunAt ?? null, cursor.triggerState ? JSON.stringify(cursor.triggerState) : null],
  );
  return inserted;
}

/** Pending triggers whose next attempt is due, oldest first so a freed slot goes to the longest wait. */
export async function listDueTriggers(now: Date): Promise<RoutineTrigger[]> {
  const iso = now.toISOString();
  const client = db();
  if (!client)
    return [...mem.values()].filter((t) => t.status === "pending" && t.nextAttemptAt <= iso).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (await client.query<Row>(
    `select ${COLUMNS} from routine_triggers where status = 'pending' and next_attempt_at <= $1 order by created_at, id`,
    [iso],
  )).map(toTrigger);
}

export async function listTriggers(routineId: string): Promise<RoutineTrigger[]> {
  const client = db();
  if (!client) return [...mem.values()].filter((t) => t.routineId === routineId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (await client.query<Row>(`select ${COLUMNS} from routine_triggers where routine_id = $1 order by created_at, id`, [routineId])).map(toTrigger);
}

export async function triggerForRun(runId: string): Promise<RoutineTrigger | null> {
  const client = db();
  if (!client) return [...mem.values()].find((t) => t.runId === runId) ?? null;
  const [row] = await client.query<Row>(`select ${COLUMNS} from routine_triggers where run_id = $1 limit 1`, [runId]);
  return row ? toTrigger(row) : null;
}

export async function updateTrigger(id: string, patch: TriggerPatch): Promise<RoutineTrigger | null> {
  const client = db();
  if (!client) {
    const t = mem.get(id);
    if (!t) return null;
    const next = { ...t, ...patch, id, updatedAt: new Date().toISOString() };
    mem.set(id, next);
    return next;
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => { params.push(value); sets.push(`${column} = $${params.length}`); };
  if (patch.status !== undefined) set("status", patch.status);
  if (patch.attempts !== undefined) set("attempts", patch.attempts);
  if (patch.nextAttemptAt !== undefined) set("next_attempt_at", patch.nextAttemptAt);
  if (patch.runId !== undefined) set("run_id", patch.runId);
  if (patch.error !== undefined) set("error", patch.error);
  if (!sets.length) return null;
  params.push(id);
  const [row] = await client.query<Row>(`update routine_triggers set ${sets.join(", ")} where id = $${params.length} returning ${COLUMNS}`, params);
  return row ? toTrigger(row) : null;
}
