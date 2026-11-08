import "server-only";
import type { RunFailedEvent } from "@/lib/projects/events";
import { getWorkspace } from "@/lib/supabase/repo/workspaces";
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
