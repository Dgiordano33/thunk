import { NOTIFICATION_LABELS, type Notification, type NotificationKind } from "@/lib/notifications/types";

/** Kinds where an agent is blocked on a person's answer, or a thought waits for review. They keep full cards; everything else is a one-line row. */
export const DECISION_KINDS: NotificationKind[] = ["capture_ready", "permission", "question", "plan", "delegation_plan", "agent_request"];
/** A ready thought closes through Keep, Discard, Go ahead or Redirect, never a bare dismiss that would strand the capture. */
export const isDismissable = (n: Notification) => n.status === "open" && n.kind !== "capture_ready";
const DELIVERY_KINDS: NotificationKind[] = ["ci_failed", "ci_stuck", "review_requested", "deploy_ready", "pr_merged"];
export const FAILED_KINDS: NotificationKind[] = ["turn_failed", "session_error", "run_failed", "ci_failed", "script_failed"];

export type Section = "decision" | "followup" | "earlier";
export function sectionOf(n: Notification): Section {
  if (n.status !== "open" || n.urgency !== "action") return "earlier";
  return DECISION_KINDS.includes(n.kind) || n.actions.length > 0 ? "decision" : "followup";
}
export const isDecision = (n: Notification) => sectionOf(n) === "decision";

/**
 * What a row leads with. Delivery titles are "CI failed · #854" with the PR title as detail, which repeats the kind
 * label and buries the PR; lead with the PR title and keep the number as metadata instead.
 */
export function describe(n: Notification): { lead: string; ref: string | null; detail: string | null } {
  const match = DELIVERY_KINDS.includes(n.kind) ? / · (#\d+)$/.exec(n.title) : null;
  if (match && n.detail) return { lead: n.detail, ref: match[1], detail: null };
  return { lead: n.title, ref: null, detail: n.detail };
}

export const isExternal = (href: string) => /^https?:\/\//.test(href);
/** Name the destination so a link never hides that it leaves Thunk. */
export function destination(n: Notification): string {
  if (!isExternal(n.href)) return n.sessionId ? "Open session" : n.workspaceId ? "Open workspace" : "Open in Thunk";
  const host = (() => { try { return new URL(n.href).hostname; } catch { return ""; } })();
  if (n.kind === "deploy_ready") return "Open preview";
  if (host.endsWith("github.com")) return /\/pull\/\d+/.test(n.href) ? "Open PR on GitHub" : "Open on GitHub";
  return `Open ${host || "link"}`;
}

export type Group = { key: string; projectId: string; kind: NotificationKind; label: string; items: Notification[] };
/** Follow-ups grouped by project, then kind, in the order their newest item arrived. */
export function groupFollowups(items: Notification[]): Group[] {
  const groups = new Map<string, Group>();
  for (const n of items) {
    const key = `${n.projectId}:${n.kind}`;
    let group = groups.get(key);
    if (!group) groups.set(key, group = { key, projectId: n.projectId, kind: n.kind, label: NOTIFICATION_LABELS[n.kind], items: [] });
    group.items.push(n);
  }
  const byProject = new Map<string, Group[]>();
  for (const g of groups.values()) byProject.set(g.projectId, [...byProject.get(g.projectId) ?? [], g]);
  return [...byProject.values()].flat();
}

/** After rows leave the list, focus the one that took the first removed row's place, else the one before it. */
export function nextFocus(order: string[], removed: string[], current: string | null): string | null {
  const gone = new Set(removed);
  const remaining = order.filter((id) => !gone.has(id));
  if (!remaining.length) return null;
  if (current && !gone.has(current)) return current;
  const start = order.findIndex((id) => gone.has(id));
  for (let i = start; i < order.length; i++) if (!gone.has(order[i])) return order[i];
  for (let i = start; i >= 0; i--) if (!gone.has(order[i])) return order[i];
  return remaining[0];
}

/** "Dismiss all" acts on the open items in view; it says so, and asks first when that includes a decision. */
export function dismissScope(items: Notification[]) {
  const open = items.filter(isDismissable);
  return { ids: open.map((n) => n.id), count: open.length, decisions: open.filter(isDecision).length };
}

/** Kinds present in the current project scope, with open counts, for the kind filter. */
export function kindCounts(items: Notification[]): { kind: NotificationKind; total: number; open: number }[] {
  const counts = new Map<NotificationKind, { kind: NotificationKind; total: number; open: number }>();
  for (const n of items) {
    const c = counts.get(n.kind) ?? { kind: n.kind, total: 0, open: 0 };
    c.total++; if (n.status === "open" && n.urgency === "action") c.open++;
    counts.set(n.kind, c);
  }
  return [...counts.values()].sort((a, b) => b.open - a.open || b.total - a.total);
}

export function plural(n: number, one: string, many = `${one}s`) { return `${n} ${n === 1 ? one : many}`; }

/**
 * Where the triage loop goes after a decision leaves the list: the next decision in the order the person saw,
 * else the one before it, else whatever arrived since. Null when no decision is left.
 */
export function nextDecision(before: string[], left: string, now: string[]): string | null {
  const live = new Set(now);
  const at = before.indexOf(left);
  for (const id of before.slice(at + 1)) if (live.has(id)) return id;
  for (const id of before.slice(0, Math.max(0, at)).reverse()) if (live.has(id)) return id;
  return now.find((id) => id !== left) ?? null;
}

export type SessionFold = { lead: Notification; rest: Notification[] };
/** Earlier rows from one session fold under its newest, so a long session reads as one row. Rows without a session stand alone. */
export function foldBySession(items: Notification[]): SessionFold[] {
  const folds: SessionFold[] = [];
  const bySession = new Map<string, SessionFold>();
  for (const n of items) {
    const fold = n.sessionId ? bySession.get(n.sessionId) : undefined;
    if (fold) { fold.rest.push(n); continue; }
    const next: SessionFold = { lead: n, rest: [] };
    folds.push(next);
    if (n.sessionId) bySession.set(n.sessionId, next);
  }
  return folds;
}
