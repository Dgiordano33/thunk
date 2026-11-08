import { handle, HttpError } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { workspaceChanges, workspaceFileDiff } from "@/lib/projects/git";
import { findRepoTarget, PRIMARY_REPO, workspaceRepoTargets } from "@/lib/projects/repo-targets";
import type { RepoChanges } from "@/lib/projects/types";

export const dynamic = "force-dynamic";

/**
 * Changed files in the workspace vs its base: `changes` for the primary checkout (as before) and
 * `repos` for every repo in a multi-repo workspace. `?path=<file>&repo=<id>` returns that file's
 * unified diff instead (`repo` defaults to the primary repo).
 */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]/changes">) => {
  const { id } = await ctx.params;
  const wctx = await getWorkspaceContext(id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  const params = new URL(req.url).searchParams;
  const file = params.get("path");

  if (file === null) {
    const { cwd, baseRef } = wctx.workspace;
    const extras = workspaceRepoTargets(wctx).filter((t) => !t.primary);
    const [changes, ...extraChanges] = await Promise.all([
      workspaceChanges(cwd, baseRef),
      ...extras.map((t) => workspaceChanges(t.cwd, t.baseRef)),
    ]);
    const repos: RepoChanges[] = extras.map((t, i) => ({ id: t.id, name: t.name, cwd: t.cwd, changes: extraChanges[i] }));
    if (repos.length) repos.unshift({ id: PRIMARY_REPO, name: wctx.project.name, cwd, changes });
    return Response.json({ changes, repos });
  }

  const repoId = params.get("repo");
  const target = repoId && repoId !== PRIMARY_REPO ? findRepoTarget(wctx, repoId) : null;
  if (repoId && repoId !== PRIMARY_REPO && !target) throw new HttpError(404, "Repo not in this workspace");
  const cwd = target?.cwd ?? wctx.workspace.cwd;
  const baseRef = target ? target.baseRef : wctx.workspace.baseRef;
  const changes = await workspaceChanges(cwd, baseRef);
  // Only diff paths git reported, so this can't read arbitrary files.
  const changed = changes?.files.find((f) => f.path === file);
  if (!changed) throw new HttpError(404, "File has no changes");
  return Response.json({ diff: await workspaceFileDiff(cwd, baseRef, changed) });
});
