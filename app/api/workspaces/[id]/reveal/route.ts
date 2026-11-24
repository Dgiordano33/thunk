import { handle, HttpError } from "@/lib/api/http";
import { getWorkspace } from "@/lib/db/repo/workspaces";
import { revealInFileManager } from "@/lib/host/native";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]/reveal">) => {
  const workspace = await getWorkspace((await ctx.params).id);
  if (!workspace) throw new HttpError(404, "Workspace not found");
  // One repo's checkout when asked for, else where sessions run.
  const repoId = new URL(req.url).searchParams.get("repo");
  const dir = repoId ? workspace.repos.find((r) => r.repoId === repoId)?.cwd : workspace.cwd;
  if (!dir) throw new HttpError(404, "Repo not found in this workspace");
  await revealInFileManager(dir);
  return Response.json({ ok: true });
});
