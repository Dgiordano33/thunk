import { handle, HttpError } from "@/lib/api/http";
import { cancelRun } from "@/lib/routines/runner";
import { getRun } from "@/lib/supabase/repo/routines";
import { OPEN_RUN_STATUSES } from "@/lib/routines/types";

export const dynamic = "force-dynamic";

/** Cancel an open run: its session is closed and its workspace kept. */
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/routines/[id]/runs/[runId]">) => {
  const { id, runId } = await ctx.params;
  const run = await getRun(runId);
  if (!run || run.routineId !== id) throw new HttpError(404, "Run not found");
  if (!OPEN_RUN_STATUSES.includes(run.status)) throw new HttpError(409, "Run already finished");
  await cancelRun(runId);
  return Response.json({ ok: true });
});
