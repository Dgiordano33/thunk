import { z } from "zod";
import { allSessions, closeSession, deleteTranscripts, listLiveSessions } from "@/lib/agent";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { getWorkspaceContext, removeWorkspace } from "@/lib/projects";
import { archiveWorkspace } from "@/lib/projects/archive";
import { withWorkspaceLock } from "@/lib/projects/runtime";
import { worktreeStatus } from "@/lib/projects/git";
import { updateWorkspace } from "@/lib/supabase/repo/workspaces";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/workspaces/[id]">) => {
  const { id } = await ctx.params;
  const wctx = await getWorkspaceContext(id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  const git = await worktreeStatus(wctx.workspace.cwd);
  return Response.json({ ...wctx, git });
});

const PatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]">) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, PatchBody);
  const wctx = await getWorkspaceContext(id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  if (body.status === "archived") await archiveWorkspace(id, { name: body.name });
  else await withWorkspaceLock(id, () => updateWorkspace(id, body));
  return Response.json({ ok: true });
});

/**
 * Delete the workspace, its sessions and their SDK transcripts. `?worktree=1` also removes the git worktree;
 * `?memory=1` its memory dir.
 */
export const DELETE = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]">) => {
  const { id } = await ctx.params;
  const params = new URL(req.url).searchParams;
  const sessions = await allSessions({ workspaceId: id });
  for (const live of listLiveSessions()) if (live.meta.workspaceId === id) closeSession(live.id);
  await removeWorkspace(id, {
    removeWorktree: params.get("worktree") === "1",
    removeMemory: params.get("memory") === "1",
  }).catch((err: Error) => {
    throw new HttpError(400, err.message);
  });
  await deleteTranscripts(sessions);
  return Response.json({ ok: true });
});
