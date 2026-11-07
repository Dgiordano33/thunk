import { z } from "zod";
import { listSessions } from "@/lib/agent";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { listExternalSessions } from "@/lib/projects";
import { deleteProject, getProject, updateProject } from "@/lib/supabase/repo/projects";
import { listWorkspaces } from "@/lib/supabase/repo/workspaces";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/projects/[id]">) => {
  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "Project not found");
  const [workspaces, owned] = await Promise.all([listWorkspaces(id), listSessions({ projectId: id, limit: 500 })]);
  const externalSessions = await listExternalSessions(project, { exclude: owned.map((s) => s.sdkSessionId) });
  return Response.json({ project, workspaces, externalSessions });
});

const PatchBody = z.object({ name: z.string().min(1).max(80) });

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/projects/[id]">) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, PatchBody);
  await updateProject(id, body);
  return Response.json({ ok: true });
});

/** Forget the project. Worktrees and memory files on disk are left alone. */
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/projects/[id]">) => {
  const { id } = await ctx.params;
  await deleteProject(id);
  return Response.json({ ok: true });
});
