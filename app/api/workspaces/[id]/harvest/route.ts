import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { harvestWorkspace, readHarvest } from "@/lib/projects/harvest";
import { withWorkspaceLock } from "@/lib/projects/runtime";
import { NoteConflictError } from "@/lib/notes/file-write";

export const dynamic = "force-dynamic";
const Body = z.object({ memory: z.string().max(200_000).nullable(), noteIds: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i).refine(id => id.toLowerCase() !== "memory")).max(1000) });

async function locked<T>(id: string, action: (ctx: NonNullable<Awaited<ReturnType<typeof getWorkspaceContext>>>) => Promise<T>) {
  try {
    return await withWorkspaceLock(id, async () => {
      const ctx = await getWorkspaceContext(id);
      if (!ctx) throw new HttpError(404, "Workspace not found");
      return action(ctx);
    });
  } catch (err) {
    if (err instanceof NoteConflictError || (err instanceof Error && err.message === "A workspace operation is already running")) throw new HttpError(409, err.message);
    throw err;
  }
}
export const GET = handle(async (_req: Request, route: RouteContext<"/api/workspaces/[id]/harvest">) => {
  const { id } = await route.params;
  return Response.json(await locked(id, readHarvest));
});
export const POST = handle(async (req: Request, route: RouteContext<"/api/workspaces/[id]/harvest">) => {
  const { id } = await route.params;
  const body = await parseBody(req, Body);
  return Response.json(await locked(id, ctx => harvestWorkspace(ctx, body)));
});
