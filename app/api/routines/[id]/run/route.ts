import { handle, HttpError } from "@/lib/api/http";
import { RunRejected, startRun } from "@/lib/routines/runner";
import { ensureScheduler } from "@/lib/routines/scheduler";
import { getRoutine } from "@/lib/supabase/repo/routines";

export const dynamic = "force-dynamic";

/** Run now. Ignores the schedule, the enabled flag and the daily limit; still one run at a time. */
export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/routines/[id]/run">) => {
  ensureScheduler();
  const { id } = await ctx.params;
  const routine = await getRoutine(id);
  if (!routine) throw new HttpError(404, "Routine not found");
  const run = await startRun(routine, "manual").catch((err) => {
    if (err instanceof RunRejected) throw new HttpError(err.status, err.message);
    throw err;
  });
  return Response.json({ run }, { status: 202 });
});
