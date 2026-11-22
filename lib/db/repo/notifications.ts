import "server-only";
import type { NewNotification, Notification, NotificationCounts, NotificationKind } from "@/lib/notifications/types";
import type { Json, Tables } from "../types";
import { db } from "../server";
import { insertSql, run, updateSql } from "../sql";

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
    // shortcut: memory mode retains 500 rows, use a database for durable history.
    if (mem.size > 500) mem.delete(mem.keys().next().value!);
    return { row, created: !existing };
  }
  const fields = { kind: values.kind, urgency: values.urgency, project_id: values.projectId,
    workspace_id: values.workspaceId, session_id: values.sessionId, run_id: values.runId, subject_key: values.subjectKey,
    title: values.title, detail: values.detail, href: values.href, actions: values.actions as Json };
  // The partial unique index arbitrates concurrent producers, including other server processes.
  try {
    const [row] = await run<Row>(client, insertSql("notifications", fields, { returning: "*" }));
    return { row: fromRow(row), created: true };
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") throw error;
  }
  const [row] = await run<Row>(client, updateSql("notifications", fields, "subject_key = $1 and status = 'open'", [input.subjectKey], "*")!);
  if (!row) return openNotification(input); // The competing row resolved between insert and update.
  return { row: fromRow(row), created: false };
}
export async function getNotification(id: string): Promise<Notification | null> {
  const client = db();
  if (!client) return mem.get(id) ?? null;
  const [row] = await client.query<Row>("select * from notifications where id::text = $1", [id]);
  return row ? fromRow(row) : null;
}
export type NotificationFilter = { status?: "open" | "all"; projectId?: string; limit?: number; before?: string; beforeId?: string };
export async function listNotifications(opts: NotificationFilter = {}): Promise<Notification[]> {
  const client = db();
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  if (!client) return [...mem.values()].filter((n) => (opts.status === "all" || n.status === "open") && (!opts.projectId || n.projectId === opts.projectId) && (!opts.before || n.createdAt < opts.before || n.createdAt === opts.before && Boolean(opts.beforeId && n.id < opts.beforeId)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, limit);
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (value: unknown) => { params.push(value); return `$${params.length}`; };
  if (opts.status !== "all") where.push("status = 'open'");
  if (opts.projectId) where.push(`project_id = ${p(opts.projectId)}`);
  if (opts.before) {
    const before = p(opts.before);
    where.push(opts.beforeId ? `(created_at < ${before} or (created_at = ${before} and id < ${p(opts.beforeId)}))` : `created_at < ${before}`);
  }
  const rows = await client.query<Row>(
    `select * from notifications${where.length ? ` where ${where.join(" and ")}` : ""} order by created_at desc, id desc limit ${p(limit)}`, params);
  return rows.map(fromRow);
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
  const where: string[] = ["true"];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)); };
  if (status) where.push("status = 'open'");
  if (read) where.push("read_at is null");
  // like() treats % and _ in the prefix as wildcards, as PostgREST's like filter did.
  if (match.subjectPrefix) add("subject_key like ?", `${match.subjectPrefix}%`);
  if (match.subjectKey) add("subject_key = ?", match.subjectKey);
  if (match.subjectKeys) add("subject_key = any(?)", match.subjectKeys);
  if (match.sessionId) add("session_id = ?", match.sessionId);
  if (match.runId) add("run_id = ?", match.runId);
  if (match.workspaceId) add("workspace_id = ?", match.workspaceId);
  if (match.projectId) add("project_id = ?", match.projectId);
  if (match.kinds) add("kind = any(?)", match.kinds);
  if (match.ids) add("id::text = any(?)", match.ids);
  const statement = updateSql("notifications", { ...(status ? { status, resolved_at: now } : {}), ...(read ? { read_at: now } : {}) }, where.join(" and "), params, "*");
  if (!statement) return [];
  return (await run<Row>(client, statement)).map(fromRow);
}
export const resolveBySubject = (subjectKey: string) => change({ subjectKey }, "resolved");
export const resolveWhere = (match: Match) => change(match, "resolved");
export const dismiss = (id: string) => change({ ids: [id] }, "dismissed");
export const dismissAll = (projectId?: string) => change({ projectId }, "dismissed");
export const dismissMany = (ids: string[]) => ids.length ? change({ ids }, "dismissed") : Promise.resolve([]);
/** Undo a dismissal. A row stays dismissed if a newer open row already claims its subject. */
export async function restore(ids: string[]): Promise<Notification[]> {
  if (!ids.length) return [];
  const now = new Date().toISOString();
  const client = db();
  if (!client) {
    const restored: Notification[] = [];
    for (const id of ids) {
      const n = mem.get(id);
      if (!n || n.status !== "dismissed" || [...mem.values()].some((o) => o.status === "open" && o.subjectKey === n.subjectKey)) continue;
      const next: Notification = { ...n, status: "open", resolvedAt: null, updatedAt: now };
      mem.set(id, next); restored.push(next);
    }
    return restored;
  }
  const rows = await client.query<Row>(
    `update notifications n set status = 'open', resolved_at = null, updated_at = $2
     where n.id::text = any($1) and n.status = 'dismissed'
       and not exists (select 1 from notifications o where o.subject_key = n.subject_key and o.status = 'open')
     returning n.*`, [ids, now]);
  return rows.map(fromRow);
}
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
    const open = await client.query<{ urgency: string; project_id: string }>("select urgency, project_id from notifications where status = 'open'");
    rows.push(...open.map((n) => ({ urgency: n.urgency as Notification["urgency"], projectId: n.project_id })));
  }
  const counts: NotificationCounts = { total: rows.length, action: 0, byProject: {} };
  for (const n of rows) if (n.urgency === "action") { counts.action++; counts.byProject[n.projectId] = (counts.byProject[n.projectId] ?? 0) + 1; }
  return counts;
}

export async function getNotification(id: string): Promise<Notification | null> {
  const client = db();
  if (!client) return mem.get(id) ?? null;
  const [row] = await client.query<Row>("select * from notifications where id::text = $1", [id]);
  return row ? fromRow(row) : null;
}

const g2 = globalThis as typeof globalThis & { __thunkMemSlackRefs?: Map<string, { channel: string; ts: string }> };
const memSlack = (g2.__thunkMemSlackRefs ??= new Map());
/** The Slack DM sent for a notification (lib/integrations/slack). */
export async function saveSlackRef(notificationId: string, ref: { channel: string; ts: string }) {
  const client = db();
  if (!client) { memSlack.set(notificationId, ref); return; }
  await client.query(
    "insert into notification_slack_messages (notification_id, channel, ts) values ($1, $2, $3) on conflict (notification_id) do update set channel = excluded.channel, ts = excluded.ts",
    [notificationId, ref.channel, ref.ts]);
}
export async function getSlackRef(notificationId: string): Promise<{ channel: string; ts: string } | null> {
  const client = db();
  if (!client) return memSlack.get(notificationId) ?? null;
  const [row] = await client.query<{ channel: string; ts: string }>("select channel, ts from notification_slack_messages where notification_id::text = $1", [notificationId]);
  return row ?? null;
}
