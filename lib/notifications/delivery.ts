import type { DeliveryHistory, DeliverySnapshot } from "@/lib/projects/delivery-history";
import { notify, resolveBySubject, resolveWhere } from "./service";
import { CI_STUCK_MS } from "./config";
import { NOTIFICATION_LABELS, type NotificationKind } from "./types";
const g = globalThis as typeof globalThis & { __thunkPendingChecks?: Map<string, { head: string; since: number; notified: boolean }> };
const pending = (g.__thunkPendingChecks ??= new Map());
export async function deliveryNotifications(projectId: string, previous: DeliveryHistory, history: DeliveryHistory, snapshots: DeliverySnapshot[], now = Date.now()) {
  const subject = (n: number) => `project:${projectId}:pr:${n}`;
  for (const e of history.events.filter((e) => e.seq > previous.seq)) {
    const key = subject(e.pr.number);
    if (e.type === "ci_passed" || e.type === "pr_merged") await resolveBySubject(`${key}:ci`);
    if (e.type === "pr_merged") {
      await resolveWhere({ projectId, subjectPrefix: `${key}:` });
    }
    if (!["ci_failed", "review_requested", "deploy_ready", "pr_merged"].includes(e.type)) continue;
    const kind = e.type as NotificationKind;
    await notify({ projectId, kind, urgency: kind === "ci_failed" || kind === "review_requested" ? "action" : "info",
      subjectKey: kind === "ci_failed" ? `${key}:ci` : kind === "review_requested" ? `${key}:review` : `${key}:${e.id}`,
      title: `${NOTIFICATION_LABELS[kind]} · #${e.pr.number}`, detail: e.pr.title, href: e.previewUrl || e.pr.url });
  }
  const subjects = new Set<string>();
  const resolveSubjects = async () => {
    const keys = [...subjects];
    // Bound the PostgREST filter URL even for projects with many PRs.
    for (let i = 0; i < keys.length; i += 100)
      await resolveWhere({ projectId, subjectKeys: keys.slice(i, i + 100) });
    subjects.clear();
  };
  for (const s of snapshots) {
    const key = subject(s.pr.number);
    if (s.state !== "OPEN") {
      for (const suffix of ["ci", "stuck", "review"]) subjects.add(`${key}:${suffix}`);
    } else {
      if (!s.requests.length) subjects.add(`${key}:review`);
      if (s.checks.length && !s.checks.some((c) => c.state === "fail" || c.state === "pending")) subjects.add(`${key}:ci`);
    }
    const waiting = s.state === "OPEN" && s.checks.some((c) => c.state === "pending") && !s.checks.some((c) => c.state === "fail");
    let state = pending.get(key);
    if (!waiting || state && state.head !== s.pr.head) {
      pending.delete(key); state = undefined;
      subjects.add(`${key}:stuck`);
    }
    if (!waiting) continue;
    if (!state) { state = { head: s.pr.head, since: now, notified: false }; pending.set(key, state); }
    // shortcut: CI age starts at first observation in this process, persist it if restart-spanning timing is needed.
    if (!state.notified && now - state.since > CI_STUCK_MS) {
      await resolveSubjects();
      await notify({ projectId, kind: "ci_stuck", urgency: "action", subjectKey: `${key}:stuck`, title: `CI pending for over 30 minutes · #${s.pr.number}`, detail: s.pr.title, href: s.pr.url });
      state.notified = true;
    }
  }
  await resolveSubjects();
}
