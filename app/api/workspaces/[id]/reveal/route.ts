import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { handle, HttpError } from "@/lib/api/http";
import { getWorkspace } from "@/lib/supabase/repo/workspaces";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]/reveal">) => {
  const workspace = await getWorkspace((await ctx.params).id);
  if (!workspace) throw new HttpError(404, "Workspace not found");
  if (process.platform !== "darwin") throw new HttpError(400, "Reveal in Finder is available on macOS");
  // One repo's checkout when asked for, else where sessions run.
  const repoId = new URL(req.url).searchParams.get("repo");
  const dir = repoId ? workspace.repos.find((r) => r.repoId === repoId)?.cwd : workspace.cwd;
  if (!dir) throw new HttpError(404, "Repo not found in this workspace");
  await promisify(execFile)("open", ["-R", dir]);
  return Response.json({ ok: true });
});
