import { z } from "zod";
import { closeSession, listLiveSessions } from "@/lib/agent";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { getWorkspaceContext, removeWorkspace } from "@/lib/projects";
import { withWorkspaceLock } from "@/lib/projects/runtime";
import { workspaceGitAction, workspaceGitState } from "@/lib/projects/workspace-git";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const GET = handle(async (_req: Request, ctx: Context) => {
  const wctx = await getWorkspaceContext((await ctx.params).id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  return Response.json({ git: await workspaceGitState(wctx) });
});
const Body = z.object({ action: z.enum(["sync", "rebase", "merge", "squash", "merge-abort", "rebase-abort", "rebase-continue"]), deleteAfter: z.boolean().default(false) });
export const POST = handle(async (req: Request, ctx: Context) => {
  const { id } = await ctx.params;
  const wctx = await getWorkspaceContext(id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  const body = await parseBody(req, Body);
  if (body.deleteAfter && body.action !== "merge" && body.action !== "squash") throw new HttpError(400, "Cleanup requires merge or squash");
  if (listLiveSessions().some((live) => live.meta.projectId === wctx.project.id && ["starting", "running", "awaiting"].includes(live.meta.status))) {
    throw new HttpError(409, "Stop active agents in this project before changing Git history");
  }
  try {
    await withWorkspaceLock(`project:${wctx.project.id}`, async () => {
      await withWorkspaceLock(id, () => workspaceGitAction(wctx, body.action));
      if (body.deleteAfter) {
        await removeWorkspace(id, { removeWorktree: true, removeMemory: true });
        for (const live of listLiveSessions()) if (live.meta.workspaceId === id) closeSession(live.id);
      }
    });
  } catch (err) {
    throw new HttpError(409, (err as Error).message);
  }
  return Response.json({ ok: true, deleted: body.deleteAfter });
});
