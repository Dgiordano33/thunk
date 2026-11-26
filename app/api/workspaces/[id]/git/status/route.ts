import { handle, HttpError } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { worktreeStatus } from "@/lib/projects/git";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const context = await getWorkspaceContext((await ctx.params).id);
  if (!context) throw new HttpError(404, "Workspace not found");
  const { workspace } = context;
  const statuses = await Promise.all(workspace.repos.map(repo => worktreeStatus(repo.cwd)));
  return Response.json({
    branch: statuses[workspace.repos.findIndex(repo => repo.cwd === workspace.cwd)]?.branch ?? workspace.branch,
    dirty: statuses.reduce((count, status) => count + (status?.dirty ?? 0), 0),
  });
});
