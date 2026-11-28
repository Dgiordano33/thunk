import { z } from "zod";
import { listSessions } from "@/lib/agent";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { getWorkspace } from "@/lib/db/repo/workspaces";
import { integrateWorkers } from "@/lib/workers/integrate";

export const dynamic = "force-dynamic";

const Body = z.object({ taskId: z.uuid().optional() });

/** Trial-merge this workspace's worker branch again and run the tests: the review card's "Run again". */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]/integrate">) => {
  const { id } = await ctx.params;
  const { taskId } = await parseBody(req, Body);
  const workspace = await getWorkspace(id);
  if (!workspace) throw new HttpError(404, "Workspace not found");
  const workers = (await listSessions({ workspaceId: id, limit: 50 })).flatMap((s) => s.origin?.kind === "worker" && !s.origin.scout ? [s.origin.taskId] : []);
  const task = taskId ?? workers[0];
  if (!task || !workers.includes(task)) throw new HttpError(404, "No worker task with a branch in this workspace");
  try {
    return Response.json({ result: await integrateWorkers(workspace.projectId, [task]) });
  } catch (err) {
    throw new HttpError(409, (err as Error).message);
  }
});
