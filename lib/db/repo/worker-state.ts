import "server-only";
import type { QueuedDelegation, Race, TaskStats } from "@/lib/workers/state";
import { db, type Db } from "../server";
import { lockKey, transaction } from "../sql";

// The chief's delegation queue, model races, per-task stats and the relay task ledger.
// Memory-only mode keeps the same shapes in maps on globalThis.

type Mem = { queue: (QueuedDelegation & { projectId: string })[]; races: Map<string, Race & { projectId: string }>; stats: Map<string, TaskStats & { projectId: string }>; relay: Map<string, Map<string, string>> };
const g = globalThis as typeof globalThis & { __thunkMemWorkerState?: Mem };
const mem: Mem = (g.__thunkMemWorkerState ??= { queue: [], races: new Map(), stats: new Map(), relay: new Map() });
const json = (v: unknown) => JSON.stringify(v);

type QueueRow = { task_id: string; chief_session_id: string | null; input: QueuedDelegation["input"]; depends_on: string[]; queued_at: string };
const toQueued = (r: QueueRow): QueuedDelegation => ({ taskId: r.task_id, chiefSessionId: r.chief_session_id, input: r.input, dependsOn: r.depends_on, queuedAt: r.queued_at });
type RaceRow = { id: string; task_id: string; entries: Race["entries"]; winner: string | null; created_at: string };
const toRace = (r: RaceRow): Race => ({ id: r.id, taskId: r.task_id, entries: r.entries, winner: r.winner, createdAt: r.created_at });
type StatsRow = { task_id: string; title: string; models: string[]; mode: TaskStats["mode"]; started_at: string; finished_at: string | null; duration_ms: number; cost_usd: number; rounds: number; outcome: string | null; counted: string[] };
const toStats = (r: StatsRow): TaskStats => ({
  taskId: r.task_id, title: r.title, models: r.models, mode: r.mode, startedAt: r.started_at, finishedAt: r.finished_at,
  durationMs: Number(r.duration_ms), costUsd: Number(r.cost_usd), rounds: r.rounds, outcome: r.outcome, counted: r.counted,
});
const strip = <T extends { projectId: string }>({ projectId, ...rest }: T) => (void projectId, structuredClone(rest));

// ---------- queue ----------

export async function insertQueueRow(tx: Db, projectId: string, item: QueuedDelegation) {
  await tx.query(
    "insert into worker_queue (task_id, project_id, chief_session_id, input, depends_on, queued_at) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6) on conflict (task_id) do nothing",
    [item.taskId, projectId, item.chiefSessionId, json(item.input), json(item.dependsOn), item.queuedAt],
  );
}

/** The project's queued delegations, oldest first. */
export async function listQueue(projectId: string): Promise<QueuedDelegation[]> {
  const client = db();
  if (!client) return mem.queue.filter((q) => q.projectId === projectId).map(strip);
  return (await client.query<QueueRow>("select * from worker_queue where project_id = $1 order by seq", [projectId])).map(toQueued);
}

export async function isQueued(taskId: string): Promise<boolean> {
  const client = db();
  if (!client) return mem.queue.some((q) => q.taskId === taskId);
  return (await client.query("select 1 from worker_queue where task_id = $1", [taskId])).length > 0;
}

/** Queue a delegation at the end of its project's queue. Returns its position (1-based). */
export async function enqueueDelegation(projectId: string, item: QueuedDelegation): Promise<number> {
  const client = db();
  if (!client) {
    if (!mem.queue.some((q) => q.taskId === item.taskId)) mem.queue.push(structuredClone({ ...item, projectId }));
    return mem.queue.filter((q) => q.projectId === projectId).length;
  }
  return transaction(client, async (tx) => {
    await insertQueueRow(tx, projectId, item);
    const [{ n }] = await tx.query<{ n: number }>("select count(*)::int as n from worker_queue where project_id = $1", [projectId]);
    return n;
  });
}

/** Remove a task from the queue. True when it was queued, so only one caller acts on a dequeue. */
export async function dequeueDelegation(taskId: string): Promise<boolean> {
  const client = db();
  if (!client) {
    const before = mem.queue.length;
    mem.queue = mem.queue.filter((q) => q.taskId !== taskId);
    return mem.queue.length < before;
  }
  return (await client.query("delete from worker_queue where task_id = $1 returning task_id", [taskId])).length > 0;
}

// ---------- races ----------

export async function insertRaceRow(tx: Db, projectId: string, race: Race) {
  await tx.query(
    "insert into worker_races (id, project_id, task_id, entries, winner, created_at) values ($1, $2, $3, $4::jsonb, $5, $6) on conflict (id) do nothing",
    [race.id, projectId, race.taskId, json(race.entries), race.winner, race.createdAt],
  );
}

export async function insertRace(projectId: string, race: Race) {
  const client = db();
  if (!client) { mem.races.set(race.id, structuredClone({ ...race, projectId })); return; }
  await insertRaceRow(client, projectId, race);
}

export async function getRace(raceId: string): Promise<Race | null> {
  const client = db();
  if (!client) { const race = mem.races.get(raceId); return race ? strip(race) : null; }
  const [row] = await client.query<RaceRow>("select * from worker_races where id = $1", [raceId]);
  return row ? toRace(row) : null;
}

/** Every race run on this task. */
export async function racesForTask(taskId: string): Promise<Race[]> {
  const client = db();
  if (!client) return [...mem.races.values()].filter((r) => r.taskId === taskId).map(strip);
  return (await client.query<RaceRow>("select * from worker_races where task_id = $1", [taskId])).map(toRace);
}

/** The race on this task that the session runs in. */
export async function findRace(taskId: string, sessionId: string): Promise<Race | null> {
  const client = db();
  if (!client) {
    const race = [...mem.races.values()].find((r) => r.taskId === taskId && r.entries.some((e) => e.sessionId === sessionId));
    return race ? strip(race) : null;
  }
  const [row] = await client.query<RaceRow>("select * from worker_races where task_id = $1 and entries @> $2::jsonb", [taskId, json([{ sessionId }])]);
  return row ? toRace(row) : null;
}

/** Pick the winner of a race that has none yet. False when someone already picked. */
export async function setRaceWinner(raceId: string, sessionId: string): Promise<boolean> {
  const client = db();
  if (!client) {
    const race = mem.races.get(raceId);
    if (!race || race.winner) return false;
    race.winner = sessionId;
    return true;
  }
  return (await client.query("update worker_races set winner = $2 where id = $1 and winner is null returning id", [raceId, sessionId])).length > 0;
}

// ---------- task stats ----------

export async function insertStatsRow(tx: Db, projectId: string, s: TaskStats) {
  await tx.query(
    `insert into task_stats (task_id, project_id, title, models, mode, started_at, finished_at, duration_ms, cost_usd, rounds, outcome, counted)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12::jsonb) on conflict (task_id) do nothing`,
    [s.taskId, projectId, s.title, json(s.models), s.mode, s.startedAt, s.finishedAt, s.durationMs, s.costUsd, s.rounds, s.outcome, json(s.counted)],
  );
}

export async function getTaskStats(taskId: string): Promise<TaskStats | null> {
  const client = db();
  if (!client) { const s = mem.stats.get(taskId); return s ? strip(s) : null; }
  const [row] = await client.query<StatsRow>("select * from task_stats where task_id = $1", [taskId]);
  return row ? toStats(row) : null;
}

export async function listTaskStats(projectId: string): Promise<TaskStats[]> {
  const client = db();
  if (!client) return [...mem.stats.values()].filter((s) => s.projectId === projectId).map(strip);
  return (await client.query<StatsRow>("select * from task_stats where project_id = $1 order by started_at desc", [projectId])).map(toStats);
}

/** Start a task's stats on its first launch, or add the models of a relaunch. */
export async function startTaskStats(projectId: string, task: { taskId: string; title: string; mode: TaskStats["mode"] }, models: string[]) {
  const fresh = (): TaskStats => ({ ...task, models: [], startedAt: new Date().toISOString(), finishedAt: null, durationMs: 0, costUsd: 0, rounds: 0, outcome: null, counted: [] });
  const merge = (existing: string[]) => [...existing, ...models.filter((m, i) => !existing.includes(m) && models.indexOf(m) === i)];
  const client = db();
  if (!client) {
    const row = mem.stats.get(task.taskId) ?? { ...fresh(), projectId };
    row.models = merge(row.models);
    mem.stats.set(task.taskId, row);
    return;
  }
  await transaction(client, async (tx) => {
    await insertStatsRow(tx, projectId, fresh());
    const [row] = await tx.query<{ models: string[] }>("select models from task_stats where task_id = $1 for update", [task.taskId]);
    await tx.query("update task_stats set models = $2::jsonb where task_id = $1", [task.taskId, json(merge(row.models))]);
  });
}

/**
 * Count one finished round (cost, rounds, outcome, duration) unless `key` was already counted.
 * Returns the stats after counting; null when the task has none.
 */
export async function countTaskFinish(taskId: string, key: string, round: { costUsd: number; ownsTask: boolean; outcome: string }): Promise<TaskStats | null> {
  const apply = (row: TaskStats) => {
    if (row.counted.includes(key)) return false;
    row.counted.push(key);
    row.costUsd += round.costUsd || 0;
    if (round.ownsTask) row.rounds += 1;
    row.outcome = round.outcome;
    row.finishedAt = new Date().toISOString();
    row.durationMs = Date.parse(row.finishedAt) - Date.parse(row.startedAt);
    return true;
  };
  const client = db();
  if (!client) {
    const row = mem.stats.get(taskId);
    if (!row) return null;
    apply(row);
    return strip(row);
  }
  return transaction(client, async (tx) => {
    const [raw] = await tx.query<StatsRow>("select * from task_stats where task_id = $1 for update", [taskId]);
    if (!raw) return null;
    const row = toStats(raw);
    if (apply(row)) {
      await tx.query(
        "update task_stats set counted = $2::jsonb, cost_usd = $3, rounds = $4, outcome = $5, finished_at = $6, duration_ms = $7 where task_id = $1",
        [taskId, json(row.counted), row.costUsd, row.rounds, row.outcome, row.finishedAt, row.durationMs],
      );
    }
    return row;
  });
}

// ---------- relay task ledger ----------

export async function insertRelayRow(tx: Db, projectId: string, relayId: string, key: string, taskId: string, replace = false) {
  await tx.query(
    `insert into relay_tasks (relay_id, key, task_id, project_id) values ($1, $2, $3, $4) on conflict (relay_id, key) ${replace ? "do update set task_id = excluded.task_id" : "do nothing"}`,
    [relayId, key, taskId, projectId],
  );
}

/** The task a relay already created under this key (`id:<task id>` or a normalized title). */
export async function relayTaskId(relayId: string, key: string): Promise<string | null> {
  const client = db();
  if (!client) return mem.relay.get(relayId)?.get(key) ?? null;
  const [row] = await client.query<{ task_id: string }>("select task_id from relay_tasks where relay_id = $1 and key = $2", [relayId, key]);
  return row?.task_id ?? null;
}

/** Every task a relay created, without repeats. */
export async function relayTaskIds(relayId: string): Promise<string[]> {
  const client = db();
  if (!client) return [...new Set(mem.relay.get(relayId)?.values() ?? [])];
  return (await client.query<{ task_id: string }>("select task_id from relay_tasks where relay_id = $1 group by task_id order by min(created_at)", [relayId])).map((r) => r.task_id);
}

/** Note that the relay owns this task, by id and (first one wins) by its title key. */
export async function rememberRelayTask(projectId: string, relayId: string, taskId: string, key: string) {
  const client = db();
  if (!client) {
    const ledger = mem.relay.get(relayId) ?? new Map<string, string>();
    ledger.set(`id:${taskId}`, taskId);
    if (!ledger.has(key)) ledger.set(key, taskId);
    mem.relay.set(relayId, ledger);
    return;
  }
  await transaction(client, async (tx) => {
    await lockKey(tx, `relay:${relayId}`);
    await insertRelayRow(tx, projectId, relayId, `id:${taskId}`, taskId, true);
    await insertRelayRow(tx, projectId, relayId, key, taskId);
  });
}
