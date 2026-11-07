import { handle, HttpError } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { workspaceChanges, workspaceFileDiff } from "@/lib/projects/git";

export const dynamic = "force-dynamic";

/** Changed files in the workspace vs its base. `?path=<file>` returns that file's unified diff instead. */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]/changes">) => {
  const { id } = await ctx.params;
  const wctx = await getWorkspaceContext(id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  const { cwd, baseRef } = wctx.workspace;
  const changes = await workspaceChanges(cwd, baseRef);
  const file = new URL(req.url).searchParams.get("path");
  if (file === null) return Response.json({ changes });
  // Only diff paths git reported, so this can't read arbitrary files.
  const changed = changes?.files.find((f) => f.path === file);
  if (!changed) throw new HttpError(404, "File has no changes");
  return Response.json({ diff: await workspaceFileDiff(cwd, baseRef, changed) });
});
