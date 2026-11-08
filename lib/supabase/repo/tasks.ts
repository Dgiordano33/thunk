import "server-only";
import { emitTask } from "@/lib/tasks/events";
import { OPEN_TASK_STATUSES, type Task, type TaskCounts, type TaskStatus } from "@/lib/tasks/types";
import type { Tables, TablesUpdate } from "../types";
import { db } from "../server";
type Row = Tables<"tasks">;
const COLUMNS = "id, project_id, workspace_id, title, body, status, priority, position, created_by, session_id, created_in_session_id, note_id, due_at, completed_at, created_at, updated_at";
function toTask(r: Row): Task { return {
  id: r.id,
  projectId: r.project_id,
  workspaceId: r.workspace_id,
  title: r.title,
  body: r.body,
  status: r.status as Task["status"],
  priority: r.priority as Task["priority"],
  position: r.position,
  createdBy: r.created_by as Task["createdBy"],
  sessionId: r.session_id,
  createdInSessionId: r.created_in_session_id,
  noteId: r.note_id,
  dueAt: r.due_at,
  completedAt: r.completed_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
}; }
function taskToRow(p: Partial<Task>): TablesUpdate<"tasks"> {
  const row: TablesUpdate<"tasks"> = {};
  if (p.id !== undefined) row.id = p.id;
  if (p.projectId !== undefined) row.project_id = p.projectId;
  if (p.workspaceId !== undefined) row.workspace_id = p.workspaceId;
  if (p.title !== undefined) row.title = p.title;
  if (p.body !== undefined) row.body = p.body;
  if (p.status !== undefined) row.status = p.status;
  if (p.priority !== undefined) row.priority = p.priority;
  if (p.position !== undefined) row.position = p.position;
  if (p.createdBy !== undefined) row.created_by = p.createdBy;
  if (p.sessionId !== undefined) row.session_id = p.sessionId;
  if (p.createdInSessionId !== undefined) row.created_in_session_id = p.createdInSessionId;
  if (p.noteId !== undefined) row.note_id = p.noteId;
  if (p.dueAt !== undefined) row.due_at = p.dueAt;
  if (p.completedAt !== undefined) row.completed_at = p.completedAt;
  if (p.createdAt !== undefined) row.created_at = p.createdAt;
  if (p.updatedAt !== undefined) row.updated_at = p.updatedAt;
  return row;
}
const g = globalThis as typeof globalThis & { __thunkMemTasks?: Map<string, Task>; __thunkTaskInserts?: Map<string, Promise<unknown>> };
const mem = (g.__thunkMemTasks ??= new Map());
export type NewTask = Pick<Task, "projectId" | "title"> & Partial<Omit<Task, "projectId" | "title" | "createdAt" | "updatedAt" | "completedAt" | "position">>;
const closed = (status: TaskStatus) => status === "done" || status === "cancelled";
function changed(task: Task, kind: "changed" | "removed" = "changed") {
  emitTask({ projectId: task.projectId, workspaceId: task.workspaceId, taskId: task.id, kind });
}
const insertQueues = (g.__thunkTaskInserts ??= new Map());
// Position is max + 1, so inserts in one scope run in turn. Thunk is a single server process.
function queueInsert(scope: string, work: () => Promise<Task>): Promise<Task> {
  const result = (insertQueues.get(scope) ?? Promise.resolve()).then(work);
  const tail = result.catch(() => {}).finally(() => { if (insertQueues.get(scope) === tail) insertQueues.delete(scope); });
  insertQueues.set(scope, tail);
  return result;
}
export function insertTask(input: NewTask): Promise<Task> {
  return queueInsert(`${input.projectId}:${input.workspaceId ?? ""}`, () => insertTaskNow(input));
}
async function insertTaskNow(input: NewTask): Promise<Task> {
  const client = db();
  const now = new Date().toISOString();
  const peers = await listTasks({ projectId: input.projectId, workspaceId: input.workspaceId ?? null });
  const task: Task = {
    id: input.id ?? crypto.randomUUID(), projectId: input.projectId, title: input.title,
    workspaceId: input.workspaceId ?? null, body: input.body ?? null,
    status: input.status ?? "open", priority: input.priority ?? 0,
    createdBy: input.createdBy ?? "user", sessionId: input.sessionId ?? null,
    createdInSessionId: input.createdInSessionId ?? null, noteId: input.noteId ?? null, dueAt: input.dueAt ?? null,
    position: (peers.length ? Math.max(...peers.map((t) => t.position)) : 0) + 1,
    completedAt: closed(input.status ?? "open") ? now : null, createdAt: now, updatedAt: now,
  };
  if (!client) {
    if (mem.has(task.id)) throw Object.assign(new Error("Task already exists"), { code: "23505" });
    mem.set(task.id, task);
    changed(task);
    return task;
  }
  const { data, error } = await client.from("tasks").insert({ ...taskToRow(task), project_id: task.projectId, title: task.title }).select(COLUMNS).single();
  if (error) throw error;
  const result = toTask(data as Row);
  changed(result);
  return result;
}
export async function getTask(id: string): Promise<Task | null> {
  const client = db();
  if (!client) return mem.get(id) ?? null;
  const { data, error } = await client.from("tasks").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toTask(data as Row) : null;
}
export async function updateTask(id: string, patch: Partial<Omit<Task, "id" | "projectId" | "createdAt" | "createdBy">>): Promise<Task | null> {
  const before = await getTask(id);
  if (!before) return null;
  const next: typeof patch = { ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), updatedAt: new Date().toISOString() };
  if (patch.status !== undefined) next.completedAt = closed(patch.status) ? before.completedAt ?? next.updatedAt : null;
  const client = db();
  let result: Task;
  if (!client) {
    result = { ...before, ...next };
    mem.set(id, result);
  } else {
    const { data, error } = await client.from("tasks").update(taskToRow(next)).eq("id", id).select(COLUMNS).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    result = toTask(data as Row);
  }
  if (before.workspaceId !== result.workspaceId) changed(before, "removed");
  changed(result);
  return result;
}
export async function deleteTask(id: string): Promise<void> {
  const task = await getTask(id);
  if (!task) return;
  const client = db();
  if (!client) mem.delete(id);
  else {
    const { error } = await client.from("tasks").delete().eq("id", id);
    if (error) throw error;
  }
  changed(task, "removed");
}
export type TaskFilter = { projectId?: string; workspaceId?: string | null; sessionId?: string; status?: "open" | TaskStatus[] };
export async function listTasks(opts: TaskFilter = {}): Promise<Task[]> {
  const statuses = opts.status === "open" ? OPEN_TASK_STATUSES : opts.status;
  const client = db();
  if (!client) return [...mem.values()].filter((t) =>
    (!opts.projectId || t.projectId === opts.projectId) &&
    (opts.workspaceId === undefined || t.workspaceId === opts.workspaceId) &&
    (!opts.sessionId || t.sessionId === opts.sessionId) && (!statuses || statuses.includes(t.status)),
  ).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  let q = client.from("tasks").select(COLUMNS).order("position").order("id");
  if (opts.projectId) q = q.eq("project_id", opts.projectId);
  if (opts.workspaceId === null) q = q.is("workspace_id", null);
  else if (opts.workspaceId !== undefined) q = q.eq("workspace_id", opts.workspaceId);
  if (opts.sessionId) q = q.eq("session_id", opts.sessionId);
  if (statuses) q = q.in("status", [...statuses]);
  const rows: Task[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await q.range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data as Row[]).map(toTask));
    if (data.length < 1000) return rows;
  }
}
export async function countOpenTasks(): Promise<TaskCounts> {
  const counts: TaskCounts = {};
  const add = (projectId: string, workspaceId: string | null) => {
    const c = (counts[projectId] ??= { project: 0, byWorkspace: {} });
    if (workspaceId) c.byWorkspace[workspaceId] = (c.byWorkspace[workspaceId] ?? 0) + 1;
    else c.project++;
  };
  const client = db();
  if (!client) {
    for (const task of await listTasks({ status: "open" })) add(task.projectId, task.workspaceId);
    return counts;
  }
  // Runs on every task event for the sidebar badges, so leave task bodies behind.
  const q = client.from("tasks").select("project_id, workspace_id").in("status", [...OPEN_TASK_STATUSES]).order("id");
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await q.range(offset, offset + 999);
    if (error) throw error;
    for (const row of data) add(row.project_id, row.workspace_id);
    if (data.length < 1000) return counts;
  }
}
