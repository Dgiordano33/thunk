import { projectSectionPath } from "@/lib/routes";
import { getRoutine } from "@/lib/db/repo/routines";
import type { Routine, RoutineRun } from "@/lib/routines/types";
import { notify, resolveWhere } from "./service";
import { hrefForProject, hrefForSession } from "@/lib/routes.server";
export async function runNotification(run: RoutineRun) {
  if (run.error?.startsWith("Skipped")) return;
  if (run.status !== "needs_attention") await resolveWhere({ runId: run.id, kinds: ["run_needs_attention"] });
  if (!["needs_attention", "succeeded", "failed"].includes(run.status)) return;
  const routine = await getRoutine(run.routineId);
  if (!routine) return;
  // A run that proposed a memory update has its proposal card instead; one that found nothing to propose stays quiet.
  if (run.status === "succeeded" && await (await import("@/lib/memory/service")).runProposed(run.id)) return;
  const kind = run.status === "needs_attention" ? "run_needs_attention" : run.status === "succeeded" ? "run_succeeded" : "run_failed";
  await notify({ kind, urgency: run.status === "needs_attention" ? "action" : "info", projectId: routine.projectId,
    workspaceId: run.workspaceId, sessionId: run.sessionId, runId: run.id, subjectKey: `run:${run.id}:${run.status}`,
    title: `${routine.name} · ${run.status.replaceAll("_", " ")}`, detail: run.summary || run.error,
    href: run.sessionId && run.workspaceId ? await hrefForSession(run.workspaceId, run.sessionId) : projectSectionPath(await hrefForProject(routine.projectId), "workshop", { routine: routine.id }) });
}

/** A trigger the dispatcher gave up on: no run exists, so the card points at the routine. */
export async function triggerFailedNotification(routine: Routine, trigger: { id: string; source: string }, error: string) {
  await notify({ kind: "run_failed", urgency: "info", projectId: routine.projectId, subjectKey: `routine-trigger:${trigger.id}:failed`,
    title: `${routine.name} · couldn't start`, detail: `The ${trigger.source.replaceAll("_", " ")} trigger failed to start a run: ${error}`,
    href: projectSectionPath(await hrefForProject(routine.projectId), "workshop", { routine: routine.id }) });
}
