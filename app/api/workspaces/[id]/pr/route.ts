import { handle, HttpError } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { workspacePrStatus } from "@/lib/projects/github";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/workspaces/[id]/pr">) => {
  const { id } = await ctx.params;
  const wctx = await getWorkspaceContext(id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  const status = await workspacePrStatus({
    cwd: wctx.workspace.cwd,
    defaultBranch: wctx.project.defaultBranch,
    baseRef: wctx.workspace.baseRef,
  });
  return Response.json({ status });
});
