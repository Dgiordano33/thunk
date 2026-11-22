import { getSession, isTerminated } from "@/lib/agent";
import { handle, HttpError } from "@/lib/api/http";
import { loadEvents } from "@/lib/db/repo/messages";
import { getNotification } from "@/lib/db/repo/notifications";
import { getProject } from "@/lib/db/repo/projects";
import { getSessionRow } from "@/lib/db/repo/sessions";
import { getTask } from "@/lib/db/repo/tasks";
import { getWorkspace } from "@/lib/db/repo/workspaces";
import { buildContext, type ContextInput } from "@/lib/notifications/context";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** Quick context for one notification: where it came from, what the agent was doing, and what it needs. */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "Invalid notification ID");
  const notification = await getNotification(id);
  if (!notification) throw new HttpError(404, "Notification not found");
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
  return Response.json({ context: buildContext(input) });
});
