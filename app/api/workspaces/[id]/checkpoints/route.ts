import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { listLiveSessions } from "@/lib/agent";
import { getWorkspaceContext } from "@/lib/projects";
import { listCheckpoints, restoreCheckpoint } from "@/lib/projects/checkpoints";
import { withWorkspaceLock } from "@/lib/projects/runtime";

export const dynamic = "force-dynamic";
const Body = z.object({ checkpointId: z.string().uuid() });

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/workspaces/[id]/checkpoints">) => {
  const { id } = await ctx.params;
  const wctx = await getWorkspaceContext(id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  return Response.json({ checkpoints: wctx.project.kind === "repo" ? await listCheckpoints(wctx.workspace.cwd, id) : [] });
});

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]/checkpoints">) => {
  const { id } = await ctx.params;
  const { checkpointId } = await parseBody(req, Body);
  const wctx = await getWorkspaceContext(id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  if (wctx.project.kind !== "repo" || wctx.workspace.status === "archived") throw new HttpError(409, "Rewind requires an active Git workspace");
  const recovery = await withWorkspaceLock(id, async () => {
    if (listLiveSessions().some((s) => s.ctx.workspace.cwd === wctx.workspace.cwd && ["starting", "running", "awaiting"].includes(s.meta.status))) {
      throw new HttpError(409, "Stop all agents in this workspace before rewinding");
    }
    return restoreCheckpoint(wctx.workspace.cwd, id, checkpointId);
  }).catch((err: Error) => { throw new HttpError(409, err.message); });
  return Response.json({ recovery });
});
