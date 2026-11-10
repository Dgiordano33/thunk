import { z } from "zod";
import { needsPerson } from "@/lib/agent/types";
import { handle, parseBody, HttpError } from "@/lib/api/http";
import { listSessions, getSession, pushUserMessage } from "@/lib/agent";
import { openChief, workersStatus } from "@/lib/workers/service";
import { noteBrief } from "@/lib/workers/notes";
import { TaskInputSchema } from "@/lib/tasks/schema";
import { taskId } from "@/lib/tasks/service";
import { hrefForSession } from "@/lib/routes.server";
const Body = z.object({ fresh: z.boolean().optional(), noteId: TaskInputSchema.shape.noteId }).strict();
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const projectId = taskId((await ctx.params).id);
  const body = await parseBody(req, Body);
  const { getProject } = await import("@/lib/supabase/repo/projects");
  const project = await getProject(projectId);
  if (!project) throw new HttpError(404, "Project not found");
  const brief = body.noteId ? await noteBrief(project, body.noteId) : null;
  const chief = await openChief(projectId, body.fresh);
  if (brief) pushUserMessage(chief, `Delegate this note: ${brief.note.path}\nSplit unchecked checklist items into separate tasks. Use noteId ${body.noteId} for each delegate call.\n\n${brief.brief}`);
  return Response.json({ sessionId: chief.id, workspaceId: chief.meta.workspaceId, href: await hrefForSession(chief.meta.workspaceId, chief.id) });
});
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const projectId = taskId((await ctx.params).id);
  const sessions = await listSessions({ projectId, limit: 10_000 });
  const chief = sessions.find((s) => s.origin?.kind === "chief") ?? null;
  const { getSessionRow } = await import("@/lib/supabase/repo/sessions");
  const { loadEvents } = await import("@/lib/supabase/repo/messages");
  const live = chief ? getSession(chief.id) : null;
  const events = chief ? live?.events ?? await loadEvents(chief.id) : [];
  const prose = events.findLast((e) => e.type === "turn_complete");
  const workers = await workersStatus(projectId);
  return Response.json({ chief, summary: prose?.type === "turn_complete" ? prose.markdown.slice(-600) : null,
    costUsd: chief ? (await getSessionRow(chief.id))?.totalCostUsd ?? events.reduce((n, e) => n + (e.type === "result" ? e.costUsd : 0), 0) : 0,
    running: workers.filter((w) => ["starting", "running"].includes(w.state)).length,
    waiting: workers.filter((w) => needsPerson({ status: w.state, waitingOn: w.waitingOn })).length,
    done: workers.filter((w) => w.task.status === "done" && w.task.completedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
  });
});
