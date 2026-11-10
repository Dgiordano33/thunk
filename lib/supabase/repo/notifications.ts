import "server-only";
import type { NewNotification, Notification, NotificationCounts, NotificationKind } from "@/lib/notifications/types";
import type { Json, Tables } from "../types";
import { db } from "../server";

type Row = Tables<"notifications">;
const g = globalThis as typeof globalThis & { __thunkMemNotifications?: Map<string, Notification> };
const mem = (g.__thunkMemNotifications ??= new Map());
function fromRow(r: Row): Notification {
  return { id: r.id, kind: r.kind as NotificationKind, urgency: r.urgency as Notification["urgency"],
    projectId: r.project_id, workspaceId: r.workspace_id, sessionId: r.session_id, runId: r.run_id,
    subjectKey: r.subject_key, title: r.title, detail: r.detail, href: r.href, actions: r.actions as Notification["actions"],
    status: r.status as Notification["status"], readAt: r.read_at, resolvedAt: r.resolved_at, createdAt: r.created_at, updatedAt: r.updated_at };
}
export async function openNotification(input: NewNotification): Promise<{ row: Notification; created: boolean }> {
  const client = db();
  const now = new Date().toISOString();
  const values = { workspaceId: null, sessionId: null, runId: null, detail: null, actions: [], ...input };
  if (!client) {
    const existing = [...mem.values()].find((n) => n.subjectKey === input.subjectKey && n.status === "open");
    const row: Notification = existing ? { ...existing, ...values, updatedAt: now } : {
      ...values, id: crypto.randomUUID(), status: "open", readAt: null, resolvedAt: null, createdAt: now, updatedAt: now,
    };
    mem.set(row.id, row);
    // shortcut: memory mode retains 500 rows, use Supabase for durable history.
    if (mem.size > 500) mem.delete(mem.keys().next().value!);
    return { row, created: !existing };
  }
  const fields = { kind: values.kind, urgency: values.urgency, project_id: values.projectId,
    workspace_id: values.workspaceId, session_id: values.sessionId, run_id: values.runId, subject_key: values.subjectKey,
    title: values.title, detail: values.detail, href: values.href, actions: values.actions as Json };
  // The partial unique index arbitrates concurrent producers, including other server processes.
  const inserted = await client.from("notifications").insert(fields).select().single();
  if (!inserted.error) return { row: fromRow(inserted.data), created: true };
  if (inserted.error.code !== "23505") throw inserted.error;
  const { data, error } = await client.from("notifications").update(fields).eq("subject_key", input.subjectKey).eq("status", "open").select().maybeSingle();
  if (error) throw error;
  if (!data) return openNotification(input); // The competing row resolved between insert and update.
  return { row: fromRow(data), created: false };
}
export type NotificationFilter = { status?: "open" | "all"; projectId?: string; limit?: number; before?: string; beforeId?: string };
export async function listNotifications(opts: NotificationFilter = {}): Promise<Notification[]> {
  const client = db();
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  if (!client) return [...mem.values()].filter((n) => (opts.status === "all" || n.status === "open") && (!opts.projectId || n.projectId === opts.projectId) && (!opts.before || n.createdAt < opts.before || n.createdAt === opts.before && Boolean(opts.beforeId && n.id < opts.beforeId)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, limit);
  let q = client.from("notifications").select().order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (opts.status !== "all") q = q.eq("status", "open");
  if (opts.projectId) q = q.eq("project_id", opts.projectId);
  if (opts.before) q = opts.beforeId ? q.or(`created_at.lt.${opts.before},and(created_at.eq.${opts.before},id.lt.${opts.beforeId})`) : q.lt("created_at", opts.before);
  const { data, error } = await q;
  if (error) throw error;
  return data.map(fromRow);
}
type Match = { subjectKeys?: string[]; subjectKey?: string; subjectPrefix?: string; sessionId?: string; runId?: string; workspaceId?: string; projectId?: string; kinds?: NotificationKind[]; ids?: string[] };
async function change(match: Match, status?: "resolved" | "dismissed", read = false): Promise<Notification[]> {
  const now = new Date().toISOString();
  const client = db();
  if (!client) {
    const changed: Notification[] = [];
    for (const n of mem.values()) {
      if (status && n.status !== "open" || read && n.readAt) continue;
      if (match.subjectKeys && !match.subjectKeys.includes(n.subjectKey) || match.subjectPrefix && !n.subjectKey.startsWith(match.subjectPrefix) || match.subjectKey && n.subjectKey !== match.subjectKey || match.sessionId && n.sessionId !== match.sessionId || match.runId && n.runId !== match.runId || match.workspaceId && n.workspaceId !== match.workspaceId || match.projectId && n.projectId !== match.projectId || match.kinds && !match.kinds.includes(n.kind) || match.ids && !match.ids.includes(n.id)) continue;
      const next = { ...n, updatedAt: now, ...(status ? { status, resolvedAt: now } : {}), ...(read ? { readAt: now } : {}) };
      mem.set(n.id, next); changed.push(next);
    }
    return changed;
  }
  let q = client.from("notifications").update({ ...(status ? { status, resolved_at: now } : {}), ...(read ? { read_at: now } : {}) });
  if (status) q = q.eq("status", "open");
  if (read) q = q.is("read_at", null);
  if (match.subjectPrefix) q = q.like("subject_key", `${match.subjectPrefix}%`);
  if (match.subjectKey) q = q.eq("subject_key", match.subjectKey);
  if (match.subjectKeys) q = q.in("subject_key", match.subjectKeys);
  if (match.sessionId) q = q.eq("session_id", match.sessionId);
  if (match.runId) q = q.eq("run_id", match.runId);
  if (match.workspaceId) q = q.eq("workspace_id", match.workspaceId);
  if (match.projectId) q = q.eq("project_id", match.projectId);
  if (match.kinds) q = q.in("kind", match.kinds);
  if (match.ids) q = q.in("id", match.ids);
  const { data, error } = await q.select();
  if (error) throw error;
  return data.map(fromRow);
}
export const resolveBySubject = (subjectKey: string) => change({ subjectKey }, "resolved");
export const resolveWhere = (match: Match) => change(match, "resolved");
export const dismiss = (id: string) => change({ ids: [id] }, "dismissed");
export const dismissAll = (projectId?: string) => change({ projectId }, "dismissed");
export async function markRead(ids: string[]) {
  const read = await change({ ids }, undefined, true);
  const resolved = await change({ ids: read.filter((n) => n.urgency === "info").map((n) => n.id) }, "resolved");
  return [...new Map([...read, ...resolved].map((n) => [n.id, n])).values()];
}
export async function countOpen(): Promise<NotificationCounts> {
  const client = db();
  const rows: Pick<Notification, "urgency" | "projectId">[] = [];
  if (!client) rows.push(...[...mem.values()].filter((n) => n.status === "open"));
  else {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from("notifications").select("urgency, project_id").eq("status", "open").order("id").range(offset, offset + 999);
      if (error) throw error;
      rows.push(...data.map((n) => ({ urgency: n.urgency as Notification["urgency"], projectId: n.project_id })));
      if (data.length < 1000) break;
    }
  }
  const counts: NotificationCounts = { total: rows.length, action: 0, byProject: {} };
  for (const n of rows) if (n.urgency === "action") { counts.action++; counts.byProject[n.projectId] = (counts.byProject[n.projectId] ?? 0) + 1; }
  return counts;
}
