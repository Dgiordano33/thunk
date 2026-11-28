import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { openPullRequest, workspacePrStatus } from "@/lib/projects/github";
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

const Body = z.object({ repoId: z.string().optional() });

/** Push the branch and open a pull request titled from the worker's report. Only a person's click calls this. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]/pr">) => {
  const { id } = await ctx.params;
  const { repoId } = await parseBody(req, Body);
  if (!(await getWorkspaceContext(id))) throw new HttpError(404, "Workspace not found");
  try {
    return Response.json(await openPullRequest(id, { repoId }));
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? "").trim();
    throw new HttpError(409, stderr.split("\n").at(-1) || (err as Error).message || "Could not open a pull request");
  }
});
