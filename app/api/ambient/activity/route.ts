import { workspaceDeliveries } from "@/lib/projects/delivery";
import { listLiveSessions } from "@/lib/agent";
import { noticeFor } from "@/lib/ambient/summary";
import type { ActivitySession } from "@/lib/ambient/types";
import { handle } from "@/lib/api/http";
import { ensureScheduler } from "@/lib/routines/scheduler";
import type { RoutineRunActivity } from "@/lib/routines/types";
import { getProject } from "@/lib/supabase/repo/projects";
import { getRoutine, listRecentRuns } from "@/lib/supabase/repo/routines";

export const dynamic = "force-dynamic";

/** Routine runs still open or finished in the last 10 minutes, with their routine and project names. */
async function recentRuns(): Promise<RoutineRunActivity[]> {
  const runs = await listRecentRuns(new Date(Date.now() - 10 * 60_000));
  const routines = new Map(await Promise.all([...new Set(runs.map((r) => r.routineId))].map(async (id) => [id, await getRoutine(id)] as const)));
  const projects = new Map(
    await Promise.all(
      [...new Set([...routines.values()].flatMap((r) => (r ? [r.projectId] : [])))].map(async (id) => [id, await getProject(id)] as const),
    ),
  );
  return runs.flatMap((run) => {
    const routine = routines.get(run.routineId);
    if (!routine) return [];
    return [{ ...run, routineName: routine.name, projectId: routine.projectId, projectName: projects.get(routine.projectId)?.name ?? "" }];
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
      pending: live.pending.size,
      notice: event ? { seq: event.seq, message: noticeFor(event)! } : null,
    };
  });
  const runs = await recentRuns().catch((err) => {
    console.error("[thunk] recent routine runs failed", err);
    return [];
  });
  return Response.json({ sessions, runs, deliveries: workspaceDeliveries() }, { headers: { "Cache-Control": "no-store" } });
});
