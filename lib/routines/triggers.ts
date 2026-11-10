import "server-only";
import type { RunFailedEvent } from "@/lib/projects/events";
import { getTask } from "@/lib/supabase/repo/tasks";
import { getWorkspace } from "@/lib/supabase/repo/workspaces";
import type { TaskEvent } from "@/lib/tasks/types";
import { listEnabledRoutines } from "@/lib/supabase/repo/routines";
import { fire } from "./runner";
import { routinesState as state } from "./state";

const RUN_FAILED_DEBOUNCE_MS = 60_000;

/** A workspace's Run script exited non-zero on its own: start the project's `run_failed` routines. */
export async function onRunFailed(event: RunFailedEvent) {
  const routines = await listEnabledRoutines({ projectId: event.projectId, event: "run_failed" });
  const targets = routines.filter((r) => r.targetKind === "ephemeral" || r.targetWorkspaceId === event.workspaceId);
  if (!targets.length) return;
  const ws = await getWorkspace(event.workspaceId);
  for (const routine of targets) {
    const key = `run_failed:${routine.id}`;
    const last = state.lastFired.get(key) ?? 0;
    if (Date.now() - last < RUN_FAILED_DEBOUNCE_MS) continue;
    state.lastFired.set(key, Date.now());
    await fire(routine, "run_failed", {
      exitCode: event.exitCode,
      workspace: { id: event.workspaceId, name: ws?.name ?? null, branch: ws?.branch ?? null },
      tail: event.tail.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").slice(-2000),
    }).catch((err) => console.error("[thunk] run_failed routine failed to start", err));
  }
}

/**
 * A task was created or completed: start the project's routines that listen for it. Changes made by routine
 * sessions themselves never fire, so a routine that files or closes tasks can't set off a chain of runs.
 */
export async function onTaskEvent(event: TaskEvent) {
  if (event.kind !== "changed" || !event.transition) return;
  const type = event.transition === "created" ? "task_created" : "task_completed";
  const routines = await listEnabledRoutines({ projectId: event.projectId, event: type });
  if (!routines.length) return;
  const task = await getTask(event.taskId);
  if (!task) return;
  const routineSessions = new Set([...state.active.values()].map((a) => a.sessionId).filter(Boolean));
  if (task.createdBy === "routine" || [task.sessionId, task.createdInSessionId].some((id) => id && routineSessions.has(id))) return;
  const ws = task.workspaceId ? await getWorkspace(task.workspaceId) : null;
  for (const routine of routines) {
    await fire(routine, type, {
      task: {
        id: task.id, title: task.title, body: task.body ?? "", status: task.status, priority: task.priority,
        createdBy: task.createdBy, noteId: task.noteId,
        workspace: ws ? { id: ws.id, name: ws.name, branch: ws.branch ?? null } : null,
      },
    }).catch((err) => console.error(`[thunk] ${type} routine failed to start`, err));
  }
}
