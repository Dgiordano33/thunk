import "server-only";
import { ensureDeliveryPolling } from "@/lib/projects/delivery";
import { getSession, isTerminated } from "@/lib/agent";
import { archiveWorkspace } from "@/lib/projects/archive";
import { projectEvents } from "@/lib/projects/events";
import { getRoutine, listDueRoutines, listOpenRuns, updateRoutine, updateRun } from "@/lib/supabase/repo/routines";
import { computeNextRun } from "./cron";
import { pollDeliveryRoutines } from "./delivery-poll";
import { pollPullRequests } from "./pr-poll";
import { fire, isRunActive } from "./runner";
import { routinesState as state } from "./state";
import { onRunFailed } from "./triggers";
import type { Routine } from "./types";

const TICK_MS = 30_000;
/** PR polling runs every Nth tick (~2 min). */
const PR_POLL_EVERY = 4;

const nextRunIso = (r: Pick<Routine, "scheduleCron" | "scheduleTz">, after: Date) =>
  computeNextRun(r.scheduleCron, r.scheduleTz, after)?.toISOString() ?? null;

/** Fire due cron routines, advance their next run, and poll PRs now and then. */
async function tick() {
  if (state.ticking) return;
  state.ticking = true;
  try {
    const now = new Date();
    for (const routine of await listDueRoutines(now)) {
      // Advance first so a slow start (worktree setup) can't make the next tick fire it again.
      await updateRoutine(routine.id, { nextRunAt: nextRunIso(routine, now) });
      await fire(routine, "cron").catch((err) => console.error(`[thunk] routine "${routine.name}" failed to start`, err));
    }
    await pollDeliveryRoutines();
    if (++state.tickCount % PR_POLL_EVERY === 0) await pollPullRequests();
  } catch (err) {
    console.error("[thunk] routines tick failed", err);
  } finally {
    state.ticking = false;
  }
}

/**
 * After a restart: runs that were open belong to sessions that died with the old process, so mark them
 * interrupted and archive their per-run worktrees. Missed cron slots fire once when the routine asks to
 * catch up, under the same guardrails as any other firing; every schedule is recomputed from now.
 */
async function reconcile() {
  for (const run of await listOpenRuns()) {
    if (isRunActive(run.id)) continue;
    const live = run.sessionId ? getSession(run.sessionId) : null;
    if (live && !isTerminated(live)) continue;
    await updateRun(run.id, { status: "failed", finishedAt: new Date().toISOString(), error: "Interrupted: Thunk server restarted" });
    if (run.workspaceId && (await getRoutine(run.routineId))?.targetKind === "ephemeral")
      await archiveWorkspace(run.workspaceId).catch((err) => console.error("[thunk] routine archive failed", err));
  }
  const now = new Date();
  for (const routine of await listDueRoutines(now)) {
    await updateRoutine(routine.id, { nextRunAt: nextRunIso(routine, now) });
    if (routine.catchUp === "once") {
      await fire(routine, "cron", { catchUp: true, missedAt: routine.nextRunAt }).catch((err) =>
        console.error(`[thunk] routine "${routine.name}" catch-up failed`, err),
      );
    }
  }
}

/** Start the routines scheduler once per server process. Safe to call from anywhere, any number of times. */
export function ensureScheduler() {
  ensureDeliveryPolling();
  // Point the long-lived timer and listeners at this module's code (matters after HMR).
  state.tick = tick;
  state.onRunFailed = (event) => void onRunFailed(event).catch((err) => console.error("[thunk] run_failed trigger", err));
  if (!state.listenersBound) {
    state.listenersBound = true;
    projectEvents().on("run_failed", (event) => state.onRunFailed(event));
  }
  if (state.timer) return;
  state.timer = setInterval(() => void state.tick(), TICK_MS);
  state.timer.unref?.();
  console.log("[thunk] routines scheduler started");
  if (!state.booted) {
    state.booted = true;
    void reconcile()
      .catch((err) => console.error("[thunk] routines reconcile failed", err))
      .then(() => state.tick());
  }
}

/** Recompute a routine's next run after its schedule or enabled flag changed. */
export function scheduleFields(r: Pick<Routine, "scheduleCron" | "scheduleTz" | "enabled">) {
  return { nextRunAt: r.enabled ? nextRunIso(r, new Date()) : null };
}
