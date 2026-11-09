import { handle, HttpError } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { workspacePrStatus } from "@/lib/projects/github";
import { findRepoTarget } from "@/lib/projects/repo-targets";

export const dynamic = "force-dynamic";

/** PR status of the workspace's anchor repo, or of one repo with `?repo=<id>`. */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]/pr">) => {
  const { id } = await ctx.params;
  const wctx = await getWorkspaceContext(id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  const repoId = new URL(req.url).searchParams.get("repo");
  const target = findRepoTarget(wctx, repoId);
  if (repoId && !target) throw new HttpError(404, "Repo not in this workspace");
  if (!target) return Response.json({ status: { branch: null, base: "main", pr: null, canCreate: false, reason: "No repositories" } });
  return Response.json({
    status: await workspacePrStatus({ cwd: target.cwd, defaultBranch: target.defaultBranch, baseRef: target.baseRef }),
  });
});
