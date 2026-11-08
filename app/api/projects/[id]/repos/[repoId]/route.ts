import { handle, HttpError } from "@/lib/api/http";
import { removeProjectRepo } from "@/lib/projects";

export const dynamic = "force-dynamic";

/** Remove a repo from the project. Refused while workspaces still have worktrees of it; nothing on disk is deleted. */
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/projects/[id]/repos/[repoId]">) => {
  const { id, repoId } = await ctx.params;
  await removeProjectRepo(id, repoId).catch((err: Error) => {
    throw new HttpError(400, err.message);
  });
  return Response.json({ ok: true });
});
