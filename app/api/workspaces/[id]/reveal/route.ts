import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { handle, HttpError } from "@/lib/api/http";
import { getWorkspace } from "@/lib/supabase/repo/workspaces";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/workspaces/[id]/reveal">) => {
  const workspace = await getWorkspace((await ctx.params).id);
  if (!workspace) throw new HttpError(404, "Workspace not found");
  if (process.platform !== "darwin") throw new HttpError(400, "Reveal in Finder is available on macOS");
  await promisify(execFile)("open", ["-R", workspace.cwd]);
  return Response.json({ ok: true });
});
