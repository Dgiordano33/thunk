import "server-only";
import type {
  Routine,
  RoutineEvent,
  RoutineRun,
  RoutineSummary,
  RunStatus,
  RunTrigger,
} from "@/lib/routines/types";
import { OPEN_RUN_STATUSES } from "@/lib/routines/types";
import type { Json, TablesUpdate } from "../types";
import { db } from "../server";
import { getProject } from "./projects";

type Row = {
  id: string;
  project_id: string;
  name: string;
  prompt: string;
  model: string;
  permission_mode: string;
  target_kind: string;
  target_workspace_id: string | null;
  schedule_cron: string | null;
  schedule_tz: string | null;
  events: string[];
  webhook_token: string | null;
  enabled: boolean;
  catch_up: string;
  max_runs_per_day: number;
  max_run_minutes: number;
  trigger_state: Json;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
};

type RunRow = {
  id: string;
  routine_id: string;
  session_id: string | null;
  workspace_id: string | null;
  trigger_source: string;
  trigger_payload: Json | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  cost_usd: number;
  summary: string | null;
  diff_stat: Json | null;
  pr_url: string | null;
  note_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS =
  "id, project_id, name, prompt, model, permission_mode, target_kind, target_workspace_id, schedule_cron, schedule_tz, events, webhook_token, enabled, catch_up, max_runs_per_day, max_run_minutes, trigger_state, last_run_at, next_run_at, created_at, updated_at";
const RUN_COLUMNS =
  "id, routine_id, session_id, workspace_id, trigger_source, trigger_payload, status, started_at, finished_at, cost_usd, summary, diff_stat, pr_url, note_id, error, created_at, updated_at";

function toRoutine(r: Row): Routine {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    prompt: r.prompt,
    model: r.model,
    permissionMode: r.permission_mode,
    targetKind: r.target_kind as Routine["targetKind"],
    targetWorkspaceId: r.target_workspace_id,
    scheduleCron: r.schedule_cron,
    scheduleTz: r.schedule_tz,
    events: (r.events ?? []) as RoutineEvent[],
    webhookToken: r.webhook_token,
    enabled: r.enabled,
    catchUp: r.catch_up as Routine["catchUp"],
    maxRunsPerDay: r.max_runs_per_day,
    maxRunMinutes: r.max_run_minutes,
    triggerState: (r.trigger_state ?? {}) as Routine["triggerState"],
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toRun(r: RunRow): RoutineRun {
  return {
    id: r.id,
    routineId: r.routine_id,
    sessionId: r.session_id,
    workspaceId: r.workspace_id,
    triggerSource: r.trigger_source as RunTrigger,
    triggerPayload: r.trigger_payload,
    status: r.status as RunStatus,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    costUsd: Number(r.cost_usd),
    summary: r.summary,
    diffStat: r.diff_stat as RoutineRun["diffStat"],
    prUrl: r.pr_url,
    noteId: r.note_id,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function routineToRow(p: Partial<Routine>): TablesUpdate<"routines"> {
  const row: TablesUpdate<"routines"> = {};
  if (p.name !== undefined) row.name = p.name;
  if (p.prompt !== undefined) row.prompt = p.prompt;
  if (p.model !== undefined) row.model = p.model;
  if (p.permissionMode !== undefined) row.permission_mode = p.permissionMode;
  if (p.targetKind !== undefined) row.target_kind = p.targetKind;
  if (p.targetWorkspaceId !== undefined) row.target_workspace_id = p.targetWorkspaceId;
  if (p.scheduleCron !== undefined) row.schedule_cron = p.scheduleCron;
  if (p.scheduleTz !== undefined) row.schedule_tz = p.scheduleTz;
  if (p.events !== undefined) row.events = p.events;
  if (p.webhookToken !== undefined) row.webhook_token = p.webhookToken;
  if (p.enabled !== undefined) row.enabled = p.enabled;
  if (p.catchUp !== undefined) row.catch_up = p.catchUp;
  if (p.maxRunsPerDay !== undefined) row.max_runs_per_day = p.maxRunsPerDay;
  if (p.maxRunMinutes !== undefined) row.max_run_minutes = p.maxRunMinutes;
  if (p.triggerState !== undefined) row.trigger_state = p.triggerState as Json;
  if (p.lastRunAt !== undefined) row.last_run_at = p.lastRunAt;
  if (p.nextRunAt !== undefined) row.next_run_at = p.nextRunAt;
  return row;
}

function runToRow(p: Partial<RoutineRun>): TablesUpdate<"routine_runs"> {
  const row: TablesUpdate<"routine_runs"> = {};
  if (p.sessionId !== undefined) row.session_id = p.sessionId;
  if (p.workspaceId !== undefined) row.workspace_id = p.workspaceId;
  if (p.triggerSource !== undefined) row.trigger_source = p.triggerSource;
  if (p.triggerPayload !== undefined) row.trigger_payload = p.triggerPayload as Json;
  if (p.status !== undefined) row.status = p.status;
  if (p.startedAt !== undefined) row.started_at = p.startedAt;
  if (p.finishedAt !== undefined) row.finished_at = p.finishedAt;
  if (p.costUsd !== undefined) row.cost_usd = p.costUsd;
  if (p.summary !== undefined) row.summary = p.summary;
  if (p.diffStat !== undefined) row.diff_stat = p.diffStat as Json;
  if (p.prUrl !== undefined) row.pr_url = p.prUrl;
  if (p.noteId !== undefined) row.note_id = p.noteId;
  if (p.error !== undefined) row.error = p.error;
  return row;
}

// Memory-only mode (no Supabase): routines live for the server's lifetime. Pinned to globalThis for HMR.
const g = globalThis as typeof globalThis & {
  __thunkMemRoutines?: Map<string, Routine>;
  __thunkMemRoutineRuns?: Map<string, RoutineRun>;
};
const mem = (g.__thunkMemRoutines ??= new Map());
const memRuns = (g.__thunkMemRoutineRuns ??= new Map());

export type NewRoutine = Omit<Routine, "id" | "createdAt" | "updatedAt" | "lastRunAt" | "triggerState"> & {
  triggerState?: Routine["triggerState"];
};

export async function insertRoutine(input: NewRoutine): Promise<Routine> {
  const client = db();
  const now = new Date().toISOString();
  if (!client) {
    const r: Routine = { id: crypto.randomUUID(), ...input, triggerState: input.triggerState ?? {}, lastRunAt: null, createdAt: now, updatedAt: now };
    mem.set(r.id, r);
    return r;
  }
  const { data, error } = await client
    .from("routines")
    .insert({ ...routineToRow(input), project_id: input.projectId, name: input.name, prompt: input.prompt, model: input.model })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return toRoutine(data as Row);
}

export async function getRoutine(id: string): Promise<Routine | null> {
  const client = db();
  if (!client) return mem.get(id) ?? null;
  const { data, error } = await client.from("routines").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toRoutine(data as Row) : null;
}

export async function updateRoutine(id: string, patch: Partial<Routine>): Promise<Routine | null> {
  const client = db();
  if (!client) {
    const r = mem.get(id);
    if (!r) return null;
    const next = { ...r, ...patch, id, updatedAt: new Date().toISOString() };
    mem.set(id, next);
    return next;
  }
  const { data, error } = await client.from("routines").update(routineToRow(patch)).eq("id", id).select(COLUMNS).maybeSingle();
  if (error) throw error;
  return data ? toRoutine(data as Row) : null;
}

export async function deleteRoutine(id: string): Promise<void> {
  const client = db();
  if (!client) {
    mem.delete(id);
    for (const [runId, run] of memRuns) if (run.routineId === id) memRuns.delete(runId);
    return;
  }
  const { error } = await client.from("routines").delete().eq("id", id);
  if (error) throw error;
}

async function listRoutineRows(opts: { projectId?: string } = {}): Promise<(Routine & { projectName: string })[]> {
  const client = db();
  if (!client) {
    const rows = [...mem.values()].filter((r) => !opts.projectId || r.projectId === opts.projectId);
    const names = new Map<string, string>();
    for (const r of rows) if (!names.has(r.projectId)) names.set(r.projectId, (await getProject(r.projectId))?.name ?? "");
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r) => ({ ...r, projectName: names.get(r.projectId) ?? "" }));
  }
  let q = client.from("routines").select(`${COLUMNS}, projects(name)`).order("created_at", { ascending: true });
  if (opts.projectId) q = q.eq("project_id", opts.projectId);
  const { data, error } = await q;
  if (error) throw error;
  return (data as unknown as (Row & { projects: { name: string } | null })[]).map((r) => ({
    ...toRoutine(r),
    projectName: r.projects?.name ?? "",
  }));
}

/** Rows the scheduler writes when it declines to fire, so the skip is visible in history. */
export const isSkip = (run: Pick<RoutineRun, "status" | "error">) => run.status === "cancelled" && Boolean(run.error?.startsWith("Skipped"));

export const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Routines with their latest run, open run and today's run count. */
export async function listRoutines(opts: { projectId?: string } = {}): Promise<RoutineSummary[]> {
  const routines = await listRoutineRows(opts);
  if (!routines.length) return [];
  const ids = routines.map((r) => r.id);
  const since = startOfToday().toISOString();
  let runs: RoutineRun[];
  const today = new Map<string, number>();
  const client = db();
  if (!client) {
    runs = [...memRuns.values()].filter((r) => ids.includes(r.routineId));
    for (const run of runs) if (run.createdAt >= since && !run.error?.startsWith("Skipped")) today.set(run.routineId, (today.get(run.routineId) ?? 0) + 1);
  } else {
    // The latest few per routine is enough for the summary; today's count needs everything since midnight.
    const [recent, todays] = await Promise.all([
      client.from("routine_runs").select(RUN_COLUMNS).in("routine_id", ids).order("created_at", { ascending: false }).limit(Math.max(50, ids.length * 5)),
      client.from("routine_runs").select("routine_id, error").in("routine_id", ids).gte("created_at", since),
    ]);
    if (recent.error) throw recent.error;
    if (todays.error) throw todays.error;
    runs = (recent.data as RunRow[]).map(toRun);
    for (const t of todays.data) if (!t.error?.startsWith("Skipped")) today.set(t.routine_id, (today.get(t.routine_id) ?? 0) + 1);
  }
  return routines.map((r) => {
    const mine = runs.filter((run) => run.routineId === r.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      ...r,
      lastRun: mine.find((run) => !isSkip(run)) ?? mine[0] ?? null,
      activeRun: mine.find((run) => OPEN_RUN_STATUSES.includes(run.status)) ?? null,
      runsToday: today.get(r.id) ?? 0,
    };
  });
}

export async function listDueRoutines(now: Date): Promise<Routine[]> {
  const client = db();
  const iso = now.toISOString();
  if (!client) return [...mem.values()].filter((r) => r.enabled && r.nextRunAt && r.nextRunAt <= iso);
  const { data, error } = await client.from("routines").select(COLUMNS).eq("enabled", true).not("next_run_at", "is", null).lte("next_run_at", iso);
  if (error) throw error;
  return (data as Row[]).map(toRoutine);
}

/** Enabled routines, optionally only those listening for an event. */
export async function listEnabledRoutines(opts: { projectId?: string; event?: RoutineEvent } = {}): Promise<Routine[]> {
  const client = db();
  if (!client)
    return [...mem.values()].filter(
      (r) => r.enabled && (!opts.projectId || r.projectId === opts.projectId) && (!opts.event || r.events.includes(opts.event)),
    );
  let q = client.from("routines").select(COLUMNS).eq("enabled", true);
  if (opts.projectId) q = q.eq("project_id", opts.projectId);
  if (opts.event) q = q.contains("events", [opts.event]);
  const { data, error } = await q;
  if (error) throw error;
  return (data as Row[]).map(toRoutine);
}

export async function countEnabledRoutines(): Promise<number> {
  const client = db();
  if (!client) return [...mem.values()].filter((r) => r.enabled).length;
  const { count, error } = await client.from("routines").select("id", { count: "exact", head: true }).eq("enabled", true);
  if (error) throw error;
  return count ?? 0;
}

export async function insertRun(input: Pick<RoutineRun, "routineId" | "triggerSource"> & Partial<RoutineRun>): Promise<RoutineRun> {
  const client = db();
  const now = new Date().toISOString();
  if (!client) {
    const run: RoutineRun = {
      id: crypto.randomUUID(),
      sessionId: null,
      workspaceId: null,
      triggerPayload: null,
      status: "queued",
      startedAt: null,
      finishedAt: null,
      costUsd: 0,
      summary: null,
      diffStat: null,
      prUrl: null,
      noteId: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    memRuns.set(run.id, run);
    return run;
  }
  const { data, error } = await client
    .from("routine_runs")
    .insert({ ...runToRow(input), routine_id: input.routineId, trigger_source: input.triggerSource })
    .select(RUN_COLUMNS)
    .single();
  if (error) throw error;
  return toRun(data as RunRow);
}

export async function updateRun(id: string, patch: Partial<RoutineRun>): Promise<RoutineRun | null> {
  const client = db();
  if (!client) {
    const run = memRuns.get(id);
    if (!run) return null;
    const next = { ...run, ...patch, id, updatedAt: new Date().toISOString() };
    memRuns.set(id, next);
    return next;
  }
  const { data, error } = await client.from("routine_runs").update(runToRow(patch)).eq("id", id).select(RUN_COLUMNS).maybeSingle();
  if (error) throw error;
  return data ? toRun(data as RunRow) : null;
}

export async function getRun(id: string): Promise<RoutineRun | null> {
  const client = db();
  if (!client) return memRuns.get(id) ?? null;
  const { data, error } = await client.from("routine_runs").select(RUN_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toRun(data as RunRow) : null;
}

export async function listRuns(routineId: string, limit = 20): Promise<RoutineRun[]> {
  const client = db();
  if (!client)
    return [...memRuns.values()]
      .filter((r) => r.routineId === routineId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  const { data, error } = await client.from("routine_runs").select(RUN_COLUMNS).eq("routine_id", routineId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data as RunRow[]).map(toRun);
}

export async function listOpenRuns(): Promise<RoutineRun[]> {
  const client = db();
  if (!client) return [...memRuns.values()].filter((r) => OPEN_RUN_STATUSES.includes(r.status));
  const { data, error } = await client.from("routine_runs").select(RUN_COLUMNS).in("status", [...OPEN_RUN_STATUSES]);
  if (error) throw error;
  return (data as RunRow[]).map(toRun);
}

/** Open runs plus runs that finished since `since`, newest first. */
export async function listRecentRuns(since: Date, limit = 20): Promise<RoutineRun[]> {
  const iso = since.toISOString();
  const client = db();
  if (!client)
    return [...memRuns.values()]
      .filter((r) => OPEN_RUN_STATUSES.includes(r.status) || (r.finishedAt && r.finishedAt >= iso))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  const { data, error } = await client
    .from("routine_runs")
    .select(RUN_COLUMNS)
    .or(`status.in.(${OPEN_RUN_STATUSES.join(",")}),finished_at.gte.${iso}`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as RunRow[]).map(toRun);
}

/** Runs that actually started since `since` (skip rows don't count against the daily limit). */
export async function countRunsSince(routineId: string, since: Date): Promise<number> {
  const iso = since.toISOString();
  const client = db();
  if (!client)
    return [...memRuns.values()].filter((r) => r.routineId === routineId && r.createdAt >= iso && !r.error?.startsWith("Skipped")).length;
  const { count, error } = await client
    .from("routine_runs")
    .select("id", { count: "exact", head: true })
    .eq("routine_id", routineId)
    .gte("created_at", iso)
    .or("error.is.null,error.not.like.Skipped*");
  if (error) throw error;
  return count ?? 0;
}
