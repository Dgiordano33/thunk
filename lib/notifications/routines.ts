import { getRoutine } from "@/lib/supabase/repo/routines";
import type { RoutineRun } from "@/lib/routines/types";
import { notify, resolveWhere } from "./service";
import { hrefForProject, hrefForSession } from "@/lib/routes.server";
export async function runNotification(run: RoutineRun) {
  if (run.error?.startsWith("Skipped")) return;
  if (run.status !== "needs_attention") await resolveWhere({ runId: run.id, kinds: ["run_needs_attention"] });
  if (!["needs_attention", "succeeded", "failed"].includes(run.status)) return;
  const routine = await getRoutine(run.routineId);
  if (!routine) return;
  const kind = run.status === "needs_attention" ? "run_needs_attention" : run.status === "succeeded" ? "run_succeeded" : "run_failed";
  await notify({ kind, urgency: run.status === "needs_attention" ? "action" : "info", projectId: routine.projectId,
    workspaceId: run.workspaceId, sessionId: run.sessionId, runId: run.id, subjectKey: `run:${run.id}:${run.status}`,
    title: `${routine.name} · ${run.status.replaceAll("_", " ")}`, detail: run.summary || run.error,
    href: run.sessionId && run.workspaceId ? await hrefForSession(run.workspaceId, run.sessionId) : `${await hrefForProject(routine.projectId)}?building=workshop&routine=${routine.id}` });
}
