import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { getSession, pushUserMessage, resumeSession, startSession } from "@/lib/agent";
import { getTask } from "@/lib/supabase/repo/tasks";
import { getSessionRow, upsertSession } from "@/lib/supabase/repo/sessions";
import { getWorkspace } from "@/lib/supabase/repo/workspaces";
import { patchTask, taskId } from "@/lib/tasks/service";
const Body = z.object({ sessionId: z.uuid().optional(), workspaceId: z.uuid().optional(), worker: z.boolean().optional() }).strict();
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const task = await getTask(taskId((await ctx.params).id));
  if (!task) throw new HttpError(404, "Task not found");
  const body = await parseBody(req, Body);
  if (body.worker) {
    const { delegate } = await import("@/lib/workers/service");
    if (body.sessionId || body.workspaceId) throw new HttpError(400, "Choose worker or a session/workspace destination");
    return Response.json(await delegate(task.projectId, null, { taskId: task.id }));
  }
  const session = body.sessionId ? getSession(body.sessionId)?.meta ?? await getSessionRow(body.sessionId) : null;
  if (body.sessionId && !session) throw new HttpError(404, "Session not found");
  if (session && body.workspaceId && session.workspaceId !== body.workspaceId) throw new HttpError(400, "Session and workspace disagree");
  const workspaceId = session?.workspaceId ?? body.workspaceId ?? task.workspaceId;
  if (!workspaceId) throw new HttpError(400, "Choose a workspace or session for this project task");
  const workspace = await getWorkspace(workspaceId);
  if (!workspace || workspace.projectId !== task.projectId || (task.workspaceId && task.workspaceId !== workspace.id))
    throw new HttpError(400, "Destination does not belong to task scope");
  if (workspace.status === "archived") throw new HttpError(400, "Workspace is archived");
  const live = body.sessionId ? await resumeSession(body.sessionId) : await startSession({ workspaceId, title: task.title.slice(0, 120) });
  if (!live) throw new HttpError(404, "Session not found");
  // Session-created persistence is asynchronous; ensure the FK exists before assigning the task.
  await upsertSession(live.meta);
  await patchTask(task.id, { sessionId: live.id });
  pushUserMessage(live, `${task.title}${task.body ? `\n\n${task.body}` : ""}\n\nTask id: ${task.id}. Claim it with tasks_update and complete it with tasks_complete.`);
  return Response.json({ sessionId: live.id, workspaceId });
});
