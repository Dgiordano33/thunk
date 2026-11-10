import { handle, HttpError } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { fileRoots, findRoot, listDirectory } from "@/lib/projects/files";

export const dynamic = "force-dynamic";

/** The workspace's file roots, or with `?root=<id>&dir=<path>` one directory level of a root. */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]/files">) => {
  const { id } = await ctx.params;
  const wctx = await getWorkspaceContext(id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  const params = new URL(req.url).searchParams;
  const dir = params.get("dir");
  if (dir === null) return Response.json({ roots: fileRoots(wctx) });
  return Response.json({ entries: await listDirectory(findRoot(wctx, params.get("root")), dir) });
});
