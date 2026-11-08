import { handle, HttpError, parseBody } from "@/lib/api/http";
import { cancelRun } from "@/lib/routines/runner";
import { RoutinePatchSchema } from "@/lib/routines/schema";
import { patchRoutine } from "@/lib/routines/service";
import { routinesState } from "@/lib/routines/state";
import { deleteRoutine, getRoutine, listRuns } from "@/lib/supabase/repo/routines";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/routines/[id]">) => {
  const { id } = await ctx.params;
  const routine = await getRoutine(id);
  if (!routine) throw new HttpError(404, "Routine not found");
  return Response.json({ routine, runs: await listRuns(id, 20) });
});

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/routines/[id]">) => {
  const { id } = await ctx.params;
  const routine = await patchRoutine(id, await parseBody(req, RoutinePatchSchema));
  return Response.json({ routine });
});

/** Delete the routine and its run history. A run in progress is cancelled first; its workspace is kept. */
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/routines/[id]">) => {
  const { id } = await ctx.params;
  const active = routinesState.active.get(id);
  if (active) await cancelRun(active.runId, "Routine deleted");
  await deleteRoutine(id);
  return Response.json({ ok: true });
});
