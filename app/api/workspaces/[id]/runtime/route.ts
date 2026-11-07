import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { prepareWorkspace, runtimeSnapshot, startWorkspaceProcess, stopWorkspaceProcesses, terminalInput } from "@/lib/projects/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Context) => {
  const wctx = await getWorkspaceContext((await ctx.params).id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  return Response.json(await runtimeSnapshot(wctx, false));
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["setup", "run", "shell"]) }),
  z.object({ action: z.literal("stop"), kind: z.enum(["setup", "run", "archive", "shell"]) }),
  z.object({ action: z.literal("input"), processId: z.uuid(), data: z.string().max(65536).optional(), cols: z.number().int().min(2).max(500).optional(), rows: z.number().int().min(1).max(200).optional() }),
]);

export const POST = handle(async (req: Request, ctx: Context) => {
  const wctx = await getWorkspaceContext((await ctx.params).id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  const body = await parseBody(req, Body);
  if (wctx.workspace.status === "archived") throw new HttpError(409, "Unarchive this workspace first");
  try {
    if (body.action === "input") terminalInput(wctx.workspace.id, body.processId, body.data, body.cols, body.rows);
    else if (body.action === "stop") await stopWorkspaceProcesses(wctx.workspace.id, body.kind);
    else if (body.action === "setup") {
      await prepareWorkspace(wctx);
    } else await startWorkspaceProcess(wctx, body.action);
  } catch (err) { throw new HttpError(409, (err as Error).message); }
  return Response.json({ ok: true });
});
