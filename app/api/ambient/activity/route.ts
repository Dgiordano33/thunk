import { workspaceDeliveries } from "@/lib/projects/delivery";
import { listLiveSessions } from "@/lib/agent";
import { noticeFor } from "@/lib/ambient/summary";
import type { ActivitySession } from "@/lib/ambient/types";
import { handle } from "@/lib/api/http";
import { ensureScheduler } from "@/lib/routines/scheduler";
import type { RoutineRunActivity } from "@/lib/routines/types";
import { listRecentRuns, listRoutineRows } from "@/lib/supabase/repo/routines";

export const dynamic = "force-dynamic";

/** Routine runs still open or finished in the last 10 minutes, with their routine and project names. */
async function recentRuns(): Promise<RoutineRunActivity[]> {
  const runs = await listRecentRuns(new Date(Date.now() - 10 * 60_000));
  if (!runs.length) return [];
  const routines = new Map((await listRoutineRows({ ids: [...new Set(runs.map((r) => r.routineId))] })).map((r) => [r.id, r]));
  return runs.flatMap((run) => {
    const routine = routines.get(run.routineId);
    if (!routine) return [];
    return [{ ...run, routineName: routine.name, projectId: routine.projectId, projectName: routine.projectName }];
  });
}

export const GET = handle(async () => {
  ensureScheduler();
  const sessions: ActivitySession[] = listLiveSessions().map((live) => {
    const event = live.events.findLast((e) => noticeFor(e) !== null);
    return {
      ...live.meta,
      live: !live.driver.isClosed,
      projectName: live.ctx.project.name,
      workspaceName: live.ctx.workspace.name,
      // Questions a chief is handling don't need the person.
      pending: [...live.pending.values()].filter((p) => p.routedTo !== "chief").length,
      notice: event ? { seq: event.seq, message: noticeFor(event)! } : null,
    };
  });
  const runs = await recentRuns().catch((err) => {
    console.error("[thunk] recent routine runs failed", err);
    return [];
  });
  return Response.json({ sessions, runs, deliveries: workspaceDeliveries(true) }, { headers: { "Cache-Control": "no-store" } });
});
