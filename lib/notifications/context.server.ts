import "server-only";
import { getSession, isTerminated } from "@/lib/agent";
import { loadEvents } from "@/lib/db/repo/messages";
import { getProject } from "@/lib/db/repo/projects";
import { getSessionRow } from "@/lib/db/repo/sessions";
import { getTask } from "@/lib/db/repo/tasks";
import { getWorkspace } from "@/lib/db/repo/workspaces";
import { buildContext, type ContextInput } from "./context";
import type { Notification } from "./types";

/** Quick context for one notification, from its live session or the persisted one. */
export async function contextFor(notification: Notification) {
  const [project, workspace] = await Promise.all([
    getProject(notification.projectId).catch(() => null),
    notification.workspaceId ? getWorkspace(notification.workspaceId).catch(() => null) : null,
  ]);
  const input: ContextInput = { notification, events: [], project: project?.name ?? null, workspace: workspace?.name ?? null, session: null, pendingIds: [] };
  if (notification.sessionId) {
    const live = getSession(notification.sessionId);
    const row = live ? null : await getSessionRow(notification.sessionId);
    const meta = live?.meta ?? row;
    if (meta) {
      const running = Boolean(live && !isTerminated(live));
      input.session = { title: meta.title ?? null, model: meta.model, status: meta.status, createdAt: meta.createdAt, origin: meta.origin, live: running };
      input.events = live ? live.events : await loadEvents(meta.id);
      // A worker's question its chief still owns isn't the person's to answer yet.
      if (live && running) input.pendingIds = [...live.pending].filter(([, p]) => p.routedTo !== "chief").map(([requestId]) => requestId);
      if (meta.origin?.kind === "worker") input.taskTitle = (await getTask(meta.origin.taskId).catch(() => null))?.title ?? null;
    }
  }
  return buildContext(input);
}
