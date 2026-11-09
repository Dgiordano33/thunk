import { handle, HttpError } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { workspaceChanges, workspaceFileDiff } from "@/lib/projects/git";
import { anchorTarget, findRepoTarget, workspaceRepoTargets } from "@/lib/projects/repo-targets";
import type { RepoChanges } from "@/lib/projects/types";

export const dynamic = "force-dynamic";

/**
 * Changed files in the workspace vs its base: `changes` for the anchor repo and `repos` for every repo
 * in a multi-repo workspace. `?path=<file>&repo=<id>` returns that file's unified diff instead
 * (`repo` defaults to the anchor repo).
 */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]/changes">) => {
  const { id } = await ctx.params;
  const wctx = await getWorkspaceContext(id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  const params = new URL(req.url).searchParams;
  const file = params.get("path");

  if (file === null) {
    const targets = workspaceRepoTargets(wctx);
    const measured = await Promise.all(targets.map((t) => workspaceChanges(t.cwd, t.baseRef)));
    const repos: RepoChanges[] = targets.length > 1 ? targets.map((t, i) => ({ id: t.id, name: t.name, cwd: t.cwd, changes: measured[i] })) : [];
    const anchor = anchorTarget(wctx);
    return Response.json({ changes: anchor ? measured[targets.findIndex((t) => t.id === anchor.id)] : null, repos });
  }

  const target = findRepoTarget(wctx, params.get("repo"));
  if (!target) throw new HttpError(404, "Repo not in this workspace");
  const changes = await workspaceChanges(target.cwd, target.baseRef);
  // Only diff paths git reported, so this can't read arbitrary files.
  const changed = changes?.files.find((f) => f.path === file);
  if (!changed) throw new HttpError(404, "File has no changes");
  return Response.json({ diff: await workspaceFileDiff(target.cwd, target.baseRef, changed) });
});
