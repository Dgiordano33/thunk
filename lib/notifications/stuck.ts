import type { LiveSession } from "@/lib/agent/session-registry";
import { SESSION_STUCK_MS } from "./config";
import { notify } from "./service";
import { hrefForSession } from "@/lib/routes.server";
export function sessionIsStuck(live: LiveSession, now = Date.now()) {
  return live.meta.status === "running" && now - (live.events.at(-1)?.ts ?? Date.parse(live.meta.createdAt)) > SESSION_STUCK_MS;
}
export async function notifyStuckSession(live: LiveSession) {
  return notify({ projectId: live.meta.projectId, workspaceId: live.meta.workspaceId, sessionId: live.id,
    kind: "session_stuck", urgency: "action", subjectKey: `session:${live.id}:stuck`,
    title: `${live.meta.title || "Agent"} has been quiet for 10 minutes`, href: await hrefForSession(live.meta.workspaceId, live.id) });
}
