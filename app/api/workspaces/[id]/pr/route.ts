import { handle, HttpError } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { workspacePrStatus } from "@/lib/projects/github";
import { findRepoTarget, PRIMARY_REPO } from "@/lib/projects/repo-targets";

export const dynamic = "force-dynamic";

/** PR status of the workspace's primary checkout, or of one extra repo with `?repo=<id>`. */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]/pr">) => {
  const { id } = await ctx.params;
  const wctx = await getWorkspaceContext(id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  const repoId = new URL(req.url).searchParams.get("repo");
  if (repoId && repoId !== PRIMARY_REPO) {
    const target = findRepoTarget(wctx, repoId);
    if (!target) throw new HttpError(404, "Repo not in this workspace");
    return Response.json({
      status: await workspacePrStatus({ cwd: target.cwd, defaultBranch: target.defaultBranch, baseRef: target.baseRef }),
    });
  }
  const status = await workspacePrStatus({
    cwd: wctx.workspace.cwd,
    defaultBranch: wctx.project.defaultBranch,
    baseRef: wctx.workspace.baseRef,
  });
  return Response.json({ status });
});
