import "server-only";
import { listLiveSessions, onSessionCreated, subscribe, type LiveSession } from "@/lib/agent";
import { listNotifications } from "@/lib/supabase/repo/notifications";
import { projectEvents } from "@/lib/projects/events";
import { notify, resolveWhere } from "./service";
import { sessionNotification } from "./session";
import { notifyStuckSession, sessionIsStuck } from "./stuck";
const g = globalThis as typeof globalThis & { __thunkNotificationsInstalled?: boolean };
export function ensureNotificationProducers() {
  if (g.__thunkNotificationsInstalled) return;
  g.__thunkNotificationsInstalled = true;
  const sessions = new WeakSet<LiveSession>();
  const stuck = new Set<string>();
  const queues = new Map<string, Promise<unknown>>();
  const queue = (id: string, work: () => Promise<unknown>) => {
    const task = (queues.get(id) ?? Promise.resolve()).then(work).catch((err) => console.error("[thunk] notification failed", err));
    queues.set(id, task);
    void task.then(() => { if (queues.get(id) === task) queues.delete(id); });
  };
  function watchNotifications(live: LiveSession) {
    if (sessions.has(live)) return;
    sessions.add(live);
    subscribe(live, (event) => {
      if (stuck.delete(live.id)) queue(live.id, () => resolveWhere({ sessionId: live.id, kinds: ["session_stuck"] }));
      if (["permission_request", "ask_question", "plan_proposed", "permission_resolved", "question_resolved", "plan_resolved", "result", "error", "status"].includes(event.type)) queue(live.id, () => sessionNotification(live, event));
    });
  }
  onSessionCreated(watchNotifications);
  for (const live of listLiveSessions()) watchNotifications(live);
  for (const event of ["run_failed", "setup_failed"] as const) projectEvents().on(event, (e) => {
    void notify({ projectId: e.projectId, workspaceId: e.workspaceId, kind: "script_failed", urgency: "info", subjectKey: `script:${e.workspaceId}:${crypto.randomUUID()}`,
      title: `${event === "setup_failed" ? "Setup" : "Run"} script exited with code ${e.exitCode}`, detail: e.tail, href: `/w/${e.workspaceId}` }).catch((err) => console.error("[thunk] script notification failed", err));
  });
  // Persisted requests from a previous server process no longer have a live resolver.
  void (async () => {
    let before: string | undefined;
    let beforeId: string | undefined;
    for (;;) {
      const rows = await listNotifications({ limit: 500, before, beforeId });
      for (const n of rows) if (n.sessionId && ["permission", "question", "plan", "session_stuck"].includes(n.kind) && !listLiveSessions().some((s) => s.id === n.sessionId))
        await resolveWhere({ sessionId: n.sessionId, kinds: ["permission", "question", "plan", "session_stuck"] });
      if (rows.length < 500) break;
      before = rows.at(-1)!.createdAt;
      beforeId = rows.at(-1)!.id;
    }
  })().catch((err) => console.error("[thunk] notification recovery failed", err));
  const timer = setInterval(() => {
    const live = listLiveSessions();
    for (const session of live) if (!stuck.has(session.id) && sessionIsStuck(session)) {
      stuck.add(session.id);
      queue(session.id, () => notifyStuckSession(session));
    }
    for (const id of stuck) if (!live.some((s) => s.id === id)) stuck.delete(id);
  }, 60_000);
  timer.unref?.();
}
